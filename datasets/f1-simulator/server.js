// server.js — static file server & WebSocket multiplayer room server for F1 simulator
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { MultiplayerServerManager } from './src/multiplayer/multiplayerServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = parseInt(process.env.PORT, 10) || 8765;
const ROOT = __dirname;

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.ico':   'image/x-icon',
  '.csv':   'text/csv; charset=utf-8',
  '.mp3':   'audio/mpeg',
  '.ogg':   'audio/ogg',
  '.wav':   'audio/wav',
  '.m4a':   'audio/mp4',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
};

export const mpServer = new MultiplayerServerManager();

const server = http.createServer((req, res) => {
  let rawUrl = req.url.split('?')[0];
  let decodedUrl = '';
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch (_) {
    decodedUrl = rawUrl;
  }

  // REST API Endpoints for multiplayer checks
  if (decodedUrl === '/api/multiplayer/public-rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, rooms: mpServer.getPublicRooms() }));
    return;
  }

  if (decodedUrl.startsWith('/api/multiplayer/room/')) {
    const roomId = decodedUrl.replace('/api/multiplayer/room/', '').toUpperCase();
    const room = mpServer.rooms.get(roomId);
    res.writeHead(room ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(room ? mpServer.serializeRoom(room) : { error: 'Room not found' }));
    return;
  }

  if (decodedUrl === '/' || decodedUrl === '') decodedUrl = '/index.html';
  let filePath = path.join(ROOT, decodedUrl);
  if (!fs.existsSync(filePath) && decodedUrl.includes('f1_team_radio_commentary.csv')) {
    const parentPath = path.join(ROOT, '..', 'f1_team_radio_commentary.csv');
    if (fs.existsSync(parentPath)) filePath = parentPath;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'text/plain';

  fs.stat(filePath, (statErr, stats) => {
    if (statErr) {
      res.writeHead(statErr.code === 'ENOENT' ? 404 : 500);
      res.end(statErr.code === 'ENOENT' ? 'Not found: ' + decodedUrl : 'Server error');
      return;
    }

    const range = req.headers.range;
    if (range && (ext === '.mp3' || ext === '.ogg' || ext === '.wav' || ext === '.m4a')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      file.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
});

// WebSocket Server attached to HTTP server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  mpServer.registerLobbySocket(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      const type = data.type;

      switch (type) {
        case 'CREATE_ROOM': {
          const res = mpServer.createRoom(data, ws);
          ws.send(JSON.stringify({ type: 'CREATE_ROOM_RESPONSE', ...res }));
          break;
        }

        case 'JOIN_ROOM': {
          const res = mpServer.joinRoom(
            data.roomId,
            data.displayName,
            ws,
            data.participantId,
            data.sessionToken
          );
          ws.send(JSON.stringify({ type: 'JOIN_ROOM_RESPONSE', ...res }));
          break;
        }

        case 'GET_PUBLIC_ROOMS': {
          const rooms = mpServer.getPublicRooms();
          ws.send(JSON.stringify({ type: 'PUBLIC_ROOMS_RESPONSE', success: true, rooms }));
          break;
        }

        case 'JOIN_PUBLIC_ROOM': {
          const res = mpServer.joinPublicRoom(
            data.roomId,
            data.displayName,
            ws,
            data.participantId,
            data.sessionToken
          );
          ws.send(JSON.stringify({ type: 'JOIN_PUBLIC_ROOM_RESPONSE', ...res }));
          break;
        }

        case 'LEAVE_ROOM': {
          const res = mpServer.leaveRoom(data.participantId);
          ws.send(JSON.stringify({ type: 'LEAVE_ROOM_RESPONSE', ...res }));
          break;
        }

        case 'SET_READY': {
          const res = mpServer.setReady(data.participantId, data.ready);
          ws.send(JSON.stringify({ type: 'SET_READY_RESPONSE', ...res }));
          break;
        }

        case 'UPDATE_CONFIG': {
          const res = mpServer.updateConfig(data.participantId, data.config);
          ws.send(JSON.stringify({ type: 'UPDATE_CONFIG_RESPONSE', ...res }));
          break;
        }

        case 'START_RACE': {
          const res = mpServer.startRace(data.participantId);
          ws.send(JSON.stringify({ type: 'START_RACE_RESPONSE', ...res }));
          break;
        }

        case 'FINISH_PARTICIPANT': {
          const res = mpServer.recordParticipantFinish(
            data.roomId,
            data.participantId,
            data.finishTime,
            data.bestLap,
            data.raceId || data.sessionId
          );
          ws.send(JSON.stringify({ type: 'FINISH_PARTICIPANT_RESPONSE', ...res }));
          break;
        }

        case 'RETURN_TO_LOBBY': {
          const res = mpServer.returnRoomToWaitingRoom(data.roomId, data.participantId);
          ws.send(JSON.stringify({ type: 'RETURN_TO_LOBBY_RESPONSE', ...res }));
          break;
        }

        case 'REMATCH': {
          const res = mpServer.rematch(data.participantId);
          ws.send(JSON.stringify({ type: 'REMATCH_RESPONSE', ...res }));
          break;
        }

        case 'RACE_TELEMETRY': {
          const roomId = mpServer.participantToRoom.get(data.participantId);
          if (roomId) {
            const room = mpServer.rooms.get(roomId);
            if (room) {
              // Update server session state
              if (room.raceSession && room.raceSession.cars[data.participantId]) {
                const c = room.raceSession.cars[data.participantId];
                c.s = data.s;
                c.v = data.v;
                c.lat = data.lat;
                c.lap = data.lap;
                c.tyreLife = data.tyreLife;
                c.batteryLevel = data.batteryLevel;
                c.drsActive = data.drsActive;
              }
              // Broadcast telemetry update to peers
              mpServer.broadcast(room, {
                type: 'PEER_TELEMETRY',
                participantId: data.participantId,
                telemetry: data
              });
            }
          }
          break;
        }

        default:
          console.warn('Unknown message type:', type);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    mpServer.unregisterLobbySocket(ws);
    mpServer.handleDisconnect(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('F1 Simulator running at http://localhost:' + PORT + '/');
  console.log('Multiplayer WebSocket ready on ws://localhost:' + PORT + '/');
});
