import kagglehub

# Download latest version
path = kagglehub.dataset_download("jtrotman/formula-1-race-data")

print("Path to dataset files:", path)