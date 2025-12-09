# BitTorrent Lite - Client Usage Guide

A lightweight BitTorrent client implementation in Node.js for educational purposes. This guide explains how to set up a seeder using Transmission and download files using this client.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Seeder Setup (Using Transmission)](#seeder-setup-using-transmission)
3. [Leecher Setup (Using This Client)](#leecher-setup-using-this-client)
4. [Complete Workflow Example](#complete-workflow-example)
5. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### For Seeder (Transmission)
- **Transmission** BitTorrent client installed
  - macOS: `brew install --cask transmission`
  - Linux: `sudo apt-get install transmission` or `sudo yum install transmission`
  - Windows: Download from [transmissionbt.com](https://transmissionbt.com)

### For Leecher (This Client)
- **Node.js** (v12 or higher)
- **npm** (comes with Node.js)

### Install Dependencies

```bash
npm install
```

---

## Seeder Setup (Using Transmission)

### Step 1: Create a Torrent File

1. **Open Transmission**
   - Launch the Transmission application

2. **Create New Torrent**
   - Go to **File → Create Torrent...** (or press `Cmd+O` on macOS / `Ctrl+O` on Windows/Linux)
   - A dialog box will appear

3. **Select File or Folder**
   - Click **"Choose"** or **"Browse"** button
   - Navigate to and select the file you want to share
   - Example: `/path/to/your/file.txt` or `/path/to/your/folder`

4. **Configure Tracker**
   - In the **"Tracker"** field, enter a tracker URL
   - Example tracker URLs:
     - `udp://tracker.opentrackr.org:1337/announce`
     - `udp://tracker.coppersurfer.tk:6969/announce`
     - `udp://tracker.leechers-paradise.org:6969/announce`
   - **Note**: For local testing, you can use a local tracker or public trackers

5. **Set Torrent Properties**
   - **Piece Size**: Leave as default (usually "Automatic" or 256 KB)
   - **Private Torrent**: Uncheck unless you want to restrict to specific trackers
   - **Source**: Optional, leave blank

6. **Create and Save**
   - Click **"Create"** button
   - Choose a location to save the `.torrent` file
   - Example: Save as `myfile.torrent` in your project directory

### Step 2: Add Torrent to Transmission (Start Seeding)

1. **Add Torrent File**
   - In Transmission, go to **File → Add** (or press `Cmd+O` / `Ctrl+O`)
   - Select the `.torrent` file you just created
   - Click **"Add"**

2. **Verify File Location**
   - Transmission will ask for the location of the original file
   - Point it to the same file/folder you used when creating the torrent
   - Click **"Verify Local Data"** if prompted

3. **Start Seeding**
   - Transmission will automatically start seeding once the file is verified
   - You should see the status change to **"Seeding"** (green icon)
   - The file is now available for download by leechers

### Step 3: Verify Seeder is Active

- Check Transmission's main window
- Status should show **"Seeding"** with a green icon
- You should see **"Seeds: 1"** in the torrent details
- The tracker should show your peer information

---

## Leecher Setup (Using This Client)

### Step 1: Obtain the Torrent File

- Get the `.torrent` file from the seeder
- Place it in your project directory
- Example: `myfile.torrent`

### Step 2: Download the File

Run the download command:

```bash
node index.js <path-to-torrent-file>
```

**Example:**
```bash
node index.js myfile.torrent
```

or with full path:
```bash
node index.js /path/to/myfile.torrent
```

### Step 3: Monitor Download Progress

The client will display:
- Progress bar showing download percentage
- Current download speed
- Average download speed
- Estimated time remaining (ETA)
- Bytes downloaded vs total size

**Example Output:**
```
🔄 [████████████░░░░░░░░] 60.5% | ↓ 1.2 MB/s | Avg: 1.0 MB/s | ETA: 00:15 | 12.5 MB / 20.7 MB
```

### Step 4: Download Controls

While downloading, you can control the process:

- **Press `p`**: Pause the download
- **Press `r`**: Resume the download
- **Press `q`**: Quit and exit
- **Press `Ctrl+C`**: Force quit

### Step 5: Completion

- When download completes, you'll see: `✅ Download complete!`
- The downloaded file will be saved with the name specified in the torrent file
- The file will be in the same directory where you ran the command

---

## Complete Workflow Example

### Scenario: Sharing a Text File

#### On Seeder Machine (Using Transmission)

1. **Create the file to share:**
   ```bash
   echo "Hello, BitTorrent!" > shared_file.txt
   ```

2. **Open Transmission and create torrent:**
   - File → Create Torrent
   - Select `shared_file.txt`
   - Tracker: `udp://tracker.opentrackr.org:1337/announce`
   - Save as `shared_file.txt.torrent`

3. **Add torrent to Transmission:**
   - File → Add
   - Select `shared_file.txt.torrent`
   - Verify file location points to `shared_file.txt`
   - Status should show "Seeding"

#### On Leecher Machine (Using This Client)

1. **Copy the torrent file:**
   ```bash
   # Copy shared_file.txt.torrent to leecher machine
   # Place it in the project directory
   ```

2. **Install dependencies (if not done):**
   ```bash
   npm install
   ```

3. **Start download:**
   ```bash
   node index.js shared_file.txt.torrent
   ```

4. **Wait for completion:**
   ```
   🛰️ Connecting to tracker: udp://tracker.opentrackr.org:1337/announce
   ✅ Connected to tracker, requesting peers...
   📋 Found 1 peers (1 seeders, 0 leechers)
   🔗 Attempting to connect to 1 new peers...
   ✅ Connected to peer: 192.168.1.100:51413
   🔄 [████████████████████] 100.0% | ↓ 2.5 MB/s | Avg: 2.0 MB/s | ETA: -- | 20 B / 20 B
   ✅ Download complete!
   ```

5. **Verify downloaded file:**
   ```bash
   cat shared_file.txt
   # Output: Hello, BitTorrent!
   ```

---

## Command Reference

### Seeder Commands (Transmission)

| Action | Command/Steps |
|--------|---------------|
| Create torrent | Transmission → File → Create Torrent |
| Start seeding | Transmission → File → Add → Select `.torrent` file |
| Stop seeding | Right-click torrent → Remove (or Remove and Delete Data) |
| View status | Check Transmission main window |

### Leecher Commands (This Client)

| Action | Command |
|--------|---------|
| Download file | `node index.js <torrent-file>` |
| Pause download | Press `p` during download |
| Resume download | Press `r` during download |
| Quit | Press `q` or `Ctrl+C` |

### Example Commands

```bash
# Download a torrent file
node index.js example.torrent

# Download with full path
node index.js /Users/username/Downloads/example.torrent

# Download from project directory
node index.js ./tor.txt.torrent
```

---

## Troubleshooting

### Seeder Issues

**Problem: Transmission shows "Stopped" instead of "Seeding"**
- **Solution**: 
  - Right-click the torrent → Start
  - Verify the original file location is correct
  - Check that the file hasn't been moved or deleted

**Problem: Tracker shows 0 seeders**
- **Solution**:
  - Wait a few minutes for tracker to update
  - Check your internet connection
  - Verify tracker URL is correct and accessible
  - Try a different tracker URL

**Problem: Firewall blocking connections**
- **Solution**:
  - Allow Transmission through firewall
  - Open port 51413 (default BitTorrent port) in router/firewall
  - Check Transmission preferences → Network → Port settings

### Leecher Issues

**Problem: "No peers found from tracker"**
- **Solution**:
  - Ensure seeder is actively seeding
  - Wait a few seconds and try again
  - Check tracker URL in torrent file
  - Verify internet connection

**Problem: "Connection to peer failed"**
- **Solution**:
  - Seeder may be offline or firewall blocking
  - Wait for more peers to become available
  - Check if seeder is still seeding in Transmission

**Problem: Download stuck at 0%**
- **Solution**:
  - Press `r` to resume (may have auto-paused)
  - Check that seeder is actively seeding
  - Verify tracker is responding
  - Try restarting the download

**Problem: "Cannot find module" error**
- **Solution**:
  ```bash
  npm install
  ```

**Problem: Download completes but file is corrupted**
- **Solution**:
  - This client doesn't verify piece hashes (educational implementation)
  - For production use, implement SHA-1 hash verification
  - Re-download the file

### Network Issues

**Problem: Slow download speeds**
- **Solution**:
  - Check seeder's upload speed
  - Ensure seeder is not rate-limited
  - Check your internet connection
  - Try connecting to more peers (if available)

**Problem: Timeout errors**
- **Solution**:
  - Check firewall settings
  - Verify tracker is accessible
  - Ensure seeder is online and seeding
  - Try a different tracker

---

## Technical Details

### How It Works

1. **Seeder (Transmission)**:
   - Creates `.torrent` file with file metadata and tracker URL
   - Registers with tracker announcing availability
   - Listens for incoming peer connections
   - Sends file pieces to requesting peers

2. **Leecher (This Client)**:
   - Parses `.torrent` file to extract metadata
   - Connects to tracker (UDP) to get peer list
   - Connects to peers (TCP) via BitTorrent handshake
   - Requests and downloads file pieces
   - Writes pieces to disk in correct order

### Protocol Flow

```
Seeder Side (Transmission):
1. Create torrent file
2. Add to Transmission
3. Register with tracker
4. Listen for peer connections
5. Send pieces on request

Leecher Side (This Client):
1. Parse torrent file
2. Query tracker for peers
3. Connect to peers
4. Perform handshake
5. Request pieces
6. Receive and write pieces
7. Complete download
```

---

## Notes

- This is an **educational implementation** and may not include all features of production BitTorrent clients
- Piece hash verification is not implemented (for simplicity)
- Upload/seeding functionality is not implemented in this client
- Use Transmission or other clients for production seeding
- Always ensure you have permission to share files before seeding

---

## License

ISC License - See package.json for details

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the code documentation in `GUIDE.md`
3. Check `PROJECT_DOCUMENTATION.md` for technical details

