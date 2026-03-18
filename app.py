import os
import sys
import subprocess
import tarfile
import urllib.request

NODE_VERSION = "20.18.0"
NODE_DIR = os.path.join(os.getcwd(), ".node")
NODE_BIN = os.path.join(NODE_DIR, "bin")
NODE = os.path.join(NODE_BIN, "node")
NPM = os.path.join(NODE_BIN, "npm")

# Step 1: Download & extract Node.js if not present
if not os.path.isfile(NODE):
    url = f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.gz"
    archive = "node.tar.gz"

    print(f"[app.py] Downloading Node.js {NODE_VERSION}...")
    urllib.request.urlretrieve(url, archive)

    print("[app.py] Extracting with Python tarfile...")
    os.makedirs(NODE_DIR, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            # strip the top-level folder (node-v20.18.0-linux-x64/)
            parts = member.name.split("/", 1)
            if len(parts) > 1 and parts[1]:
                member.name = parts[1]
                tar.extract(member, NODE_DIR)

    os.remove(archive)
    os.chmod(NODE, 0o755)
    print("[app.py] Node.js installed!")
else:
    print("[app.py] Node.js found, skipping download.")

# Step 2: Add to PATH
os.environ["PATH"] = NODE_BIN + ":" + os.environ.get("PATH", "")

# Step 3: npm install
print("[app.py] Running npm install...")
subprocess.run([NODE, NPM, "install", "--production"], check=True)

# Step 4: Start the bot
print("[app.py] Starting: node index.js")
os.execvp(NODE, [NODE, "index.js"])
