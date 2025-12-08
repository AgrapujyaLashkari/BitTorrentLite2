"use strict";
const fs = require("fs");
const net = require("net");
const tracker = require("./tracker");
const message = require("./message");
const Pieces = require("./Pieces");
const Queue = require("./Queue");
const DEFAULT_INTERVAL_SECONDS = 1800;
const MIN_INTERVAL_SECONDS = 60;
const NO_PEER_TIMEOUT_MS = 120000; // 2 minutes timeout if no peers/data
const WARNING_INTERVALS_MS = [90000, 60000, 30000, 15000, 10000, 5000]; // Warning times before timeout
module.exports = (torrent, path) => {
  const pieces = new Pieces(torrent);
  const file = fs.openSync(path, "w");
  const connectedPeers = new Set();
  const activeDataTransferPeers = new Set(); // Peers that are actually transferring data
  const activeSockets = new Map(); // Track all active sockets: peerKey -> socket
  let peerDiscoveryInterval = null;
  let noPeerTimeout = null;
  let warningIntervals = [];
  let lastDataTransferTime = Date.now();
  let hasReceivedData = false;
  let isPaused = false;
  let currentInterval = null;
  let lastKnownPeers = [];
  function cleanupAndExit(exitCode = 0, message = "") {
    // Clear all intervals and timeouts
    if (peerDiscoveryInterval) {
      clearInterval(peerDiscoveryInterval);
      peerDiscoveryInterval = null;
    }
    if (noPeerTimeout) {
      clearTimeout(noPeerTimeout);
      noPeerTimeout = null;
    }
    warningIntervals.forEach((interval) => clearTimeout(interval));
    warningIntervals = [];
    pieces.stopProgressDisplay();
    try {
      fs.closeSync(file);
    } catch (e) {}
    if (message) {
      process.stderr.write(message + "\n");
    }
    process.exit(exitCode);
  }
  function resetNoPeerTimeout() {
    // Clear existing timeout and warnings
    if (noPeerTimeout) {
      clearTimeout(noPeerTimeout);
      noPeerTimeout = null;
    }
    warningIntervals.forEach((interval) => clearTimeout(interval));
    warningIntervals = [];
    // Set up new timeout
    noPeerTimeout = setTimeout(() => {
      if (!hasReceivedData || activeDataTransferPeers.size === 0) {
        pieces.stopProgressDisplay();
        process.stderr.write(
          "\n:warning: No active peer connections or data transfer detected.\n"
        );
        if (!hasReceivedData) {
          process.stderr.write(
            ":x: No data received. Exiting due to timeout...\n"
          );
        } else {
          process.stderr.write(
            ":x: All peer connections lost. Exiting due to timeout...\n"
          );
        }
        cleanupAndExit(1);
      }
    }, NO_PEER_TIMEOUT_MS);
    // Set up warning intervals
    WARNING_INTERVALS_MS.forEach((warningTime) => {
      const warningTimeout = setTimeout(() => {
        const remainingSeconds = Math.ceil(warningTime / 1000);
        if (!hasReceivedData || activeDataTransferPeers.size === 0) {
          if (!hasReceivedData) {
            process.stderr.write(
              `:hourglass_flowing_sand: Warning: No data transfer detected. Will exit in ${remainingSeconds}s if no progress...\n`
            );
          } else {
            process.stderr.write(
              `:hourglass_flowing_sand: Warning: No active peer connections. Will exit in ${remainingSeconds}s if no reconnection...\n`
            );
          }
        }
      }, NO_PEER_TIMEOUT_MS - warningTime);
      warningIntervals.push(warningTimeout);
    });
  }
  // Create download module interface
  const downloadModule = {
    _activeSockets: activeSockets, // Expose for socket tracking
    markDataTransfer: (peerKey) => {
      hasReceivedData = true;
      lastDataTransferTime = Date.now();
      activeDataTransferPeers.add(peerKey);
      // Reset timeout when we have active data transfer
      if (activeDataTransferPeers.size > 0 && !isPaused) {
        resetNoPeerTimeout();
      }
    },
    markPeerDisconnected: (peerKey) => {
      activeDataTransferPeers.delete(peerKey);
      activeSockets.delete(peerKey);
      // If no active peers and no recent data, start timeout countdown
      if (activeDataTransferPeers.size === 0 && !isPaused) {
        const timeSinceLastData = Date.now() - lastDataTransferTime;
        if (timeSinceLastData > 30000) {
          // 30 seconds since last data
          resetNoPeerTimeout();
        }
      }
    },
    onDownloadComplete: () => {
      cleanupAndExit(0, ":white_check_mark: Download complete!");
    },
    pause: () => {
      if (isPaused) {
        process.stderr.write(":information_source: Download is already paused\n");
        return;
      }
      isPaused = true;
      process.stderr.write(":pause_button: Pausing download...\n");
      
      // Stop progress display
      pieces.stopProgressDisplay();
      
      // Stop peer discovery interval
      if (peerDiscoveryInterval) {
        clearInterval(peerDiscoveryInterval);
        peerDiscoveryInterval = null;
      }
      
      // Clear timeouts
      if (noPeerTimeout) {
        clearTimeout(noPeerTimeout);
        noPeerTimeout = null;
      }
      warningIntervals.forEach((interval) => clearTimeout(interval));
      warningIntervals = [];
      
      // Close all active socket connections
      let closedCount = 0;
      activeSockets.forEach((socket, peerKey) => {
        try {
          socket.destroy(); // Use destroy instead of end to force close
          closedCount++;
        } catch (e) {
          // Socket might already be closed
        }
      });
      activeSockets.clear();
      connectedPeers.clear();
      activeDataTransferPeers.clear();
      
      // Reset requested pieces that weren't received (they'll be requested again on resume)
      // This ensures pieces that were requested but not received can be requested again
      pieces.resetRequestedState();
      
      // Clear the progress line and show paused status
      process.stdout.write("\r\x1b[K");
      process.stderr.write(`:white_check_mark: Paused. Closed ${closedCount} peer connections.\n`);
      process.stderr.write(":keyboard: Press 'r' to resume or 'q' to quit\n");
    },
    resume: () => {
      if (!isPaused) {
        process.stderr.write(":information_source: Download is already running\n");
        return;
      }
      isPaused = false;
      process.stderr.write(":arrow_forward: Resuming download...\n");
      
      // Restart progress display
      pieces.startProgressDisplay();
      
      // Reset timeout mechanism
      resetNoPeerTimeout();
      
      // Ensure connectedPeers is cleared (should be, but double-check)
      connectedPeers.clear();
      
      // Restart peer discovery - always query tracker for fresh peers
      const interval = currentInterval || DEFAULT_INTERVAL_SECONDS;
      tracker.getPeers(torrent, (peers, newInterval) => {
        currentInterval = newInterval || interval;
        if (peers.length > 0) {
          // Use fresh peers from tracker
          connectToPeers(peers, currentInterval);
        } else if (lastKnownPeers.length > 0) {
          // If no new peers but we have cached ones, use cached peers
          process.stderr.write(":information_source: No new peers found, reconnecting to cached peers...\n");
          // Clear connectedPeers to allow reconnection to cached peers
          connectedPeers.clear();
          connectToPeers(lastKnownPeers, currentInterval);
        } else {
          // No peers at all - set up interval to retry
          process.stderr.write(":warning: No peers found from tracker. Will retry...\n");
          connectToPeers([], currentInterval);
        }
      });
    },
    isPaused: () => isPaused,
  };
  function connectToPeers(peers, interval) {
    if (pieces.isDone()) {
      cleanupAndExit(0, ":white_check_mark: Download complete!");
      return;
    }
    if (isPaused) {
      return; // Don't connect if paused
    }
    
    // Store peers and interval for resume
    if (peers.length > 0) {
      lastKnownPeers = peers;
    }
    if (interval) {
      currentInterval = interval;
    }
    
    const newPeers = peers.filter((peer) => {
      const peerKey = `${peer.ip}:${peer.port}`;
      // Allow reconnection if not currently connected (connectedPeers is cleared on pause)
      return !connectedPeers.has(peerKey);
    });
    if (newPeers.length > 0) {
      process.stderr.write(
        `:link: Attempting to connect to ${newPeers.length} new peers...\n`
      );
      newPeers.forEach((peer) => {
        const peerKey = `${peer.ip}:${peer.port}`;
        // Mark as attempting connection before actually connecting
        // This prevents duplicate connection attempts
        connectedPeers.add(peerKey);
        download(
          peer,
          torrent,
          pieces,
          file,
          () => {
            // Remove from connected peers on disconnect so we can reconnect later
            connectedPeers.delete(peerKey);
          },
          downloadModule
        );
      });
    } else if (peers.length > 0) {
      // All peers are already being connected to
      process.stderr.write(
        `:information_source: All ${peers.length} peers are already being connected to\n`
      );
    } else {
      process.stderr.write(
        ":information_source:  No new peers to connect to\n"
      );
    }
    // Set up periodic peer discovery if interval is provided
    if (interval && !peerDiscoveryInterval && !isPaused) {
      const intervalMs = Math.max(interval * 1000, MIN_INTERVAL_SECONDS * 1000);
      process.stderr.write(
        `:alarm_clock: Setting up periodic peer discovery every ${
          interval / 60
        } minutes\n`
      );
      peerDiscoveryInterval = setInterval(() => {
        // Check if download is complete or paused before discovering more peers
        if (pieces.isDone() || isPaused) {
          if (pieces.isDone()) {
            clearInterval(peerDiscoveryInterval);
            peerDiscoveryInterval = null;
            process.stderr.write(
              ":white_check_mark: Download complete, stopping peer discovery\n"
            );
          }
          return;
        }
        process.stderr.write(
          ":arrows_counterclockwise: Discovering more peers...\n"
        );
        tracker.getPeers(torrent, (newPeers, newInterval) => {
          connectToPeers(newPeers, newInterval || interval);
        });
      }, intervalMs);
    }
  }
  // Start the no-peer timeout mechanism
  resetNoPeerTimeout();
  // Initial peer discovery
  tracker.getPeers(torrent, (peers, interval) => {
    currentInterval = interval || DEFAULT_INTERVAL_SECONDS;
    if (peers.length === 0) {
      process.stderr.write(
        ":warning: No peers found from tracker. Will retry...\n"
      );
    }
    connectToPeers(peers, currentInterval);
  });
  // Return cleanup function and pause/resume controls for external use
  return {
    cleanup: () => cleanupAndExit(0),
    pause: () => downloadModule.pause(),
    resume: () => downloadModule.resume(),
    isPaused: () => downloadModule.isPaused(),
  };
};
function download(peer, torrent, pieces, file, onDisconnect, downloadModule) {
  const socket = new net.Socket();
  const peerKey = `${peer.ip}:${peer.port}`;
  
  // Track socket for pause/resume functionality
  if (downloadModule && downloadModule._activeSockets) {
    downloadModule._activeSockets.set(peerKey, socket);
  }
  
  socket.on("error", (err) => {
    process.stderr.write(
      `:x: Connection to ${peer.ip}:${peer.port} failed: ${err.message}\n`
    );
    if (downloadModule) {
      downloadModule.markPeerDisconnected(peerKey);
    }
    if (onDisconnect) onDisconnect();
  });
  socket.on("close", () => {
    if (downloadModule) {
      downloadModule.markPeerDisconnected(peerKey);
    }
    if (onDisconnect) onDisconnect();
  });
  socket.connect(peer.port, peer.ip, () => {
    // Don't connect if paused
    if (downloadModule && downloadModule.isPaused && downloadModule.isPaused()) {
      socket.end();
      return;
    }
    process.stderr.write(
      `:white_check_mark: Connected to peer: ${peer.ip}:${peer.port}\n`
    );
    socket.write(message.buildHandshake(torrent));
  });
  const queue = new Queue(torrent);
  onWholeMsg(socket, (msg) =>
    msgHandler(
      msg,
      socket,
      pieces,
      queue,
      torrent,
      file,
      downloadModule,
      peerKey
    )
  );
}
function onWholeMsg(socket, callback) {
  let savedBuf = Buffer.alloc(0);
  let handshake = true;
  socket.on("data", (recvBuf) => {
    // msgLen calculates the length of a whole message
    const msgLen = () =>
      handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
    savedBuf = Buffer.concat([savedBuf, recvBuf]);
    while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
      callback(savedBuf.slice(0, msgLen()));
      savedBuf = savedBuf.slice(msgLen());
      handshake = false;
    }
  });
}
function msgHandler(
  msg,
  socket,
  pieces,
  queue,
  torrent,
  file,
  downloadModule,
  peerKey
) {
  // Don't process messages if paused
  if (downloadModule && downloadModule.isPaused && downloadModule.isPaused()) {
    return;
  }
  
  if (isHandshake(msg)) {
    socket.write(message.buildInterested());
  } else {
    const m = message.parse(msg);
    if (m.id === 0) chokeHandler(socket);
    if (m.id === 1) unchokeHandler(socket, pieces, queue, downloadModule);
    if (m.id === 4) haveHandler(socket, pieces, queue, m.payload, downloadModule);
    if (m.id === 5) bitfieldHandler(socket, pieces, queue, m.payload, downloadModule);
    if (m.id === 7)
      pieceHandler(
        socket,
        pieces,
        queue,
        torrent,
        file,
        m.payload,
        downloadModule,
        peerKey
      );
  }
}
function isHandshake(msg) {
  return (
    msg.length === msg.readUInt8(0) + 49 &&
    msg.toString("utf8", 1, 20) === "BitTorrent protocol"
  );
}
function chokeHandler(socket) {
  socket.end();
}
function unchokeHandler(socket, pieces, queue, downloadModule) {
  queue.choked = false;
  requestPiece(socket, pieces, queue, downloadModule);
}
function haveHandler(socket, pieces, queue, payload, downloadModule) {
  const pieceIndex = payload.readUInt32BE(0);
  const queueEmpty = queue.length === 0;
  queue.queue(pieceIndex);
  if (queueEmpty) requestPiece(socket, pieces, queue, downloadModule);
}
function bitfieldHandler(socket, pieces, queue, payload, downloadModule) {
  const queueEmpty = queue.length === 0;
  payload.forEach((byte, i) => {
    for (let j = 0; j < 8; j++) {
      if (byte % 2) queue.queue(i * 8 + 7 - j);
      byte = Math.floor(byte / 2);
    }
  });
  if (queueEmpty) requestPiece(socket, pieces, queue, downloadModule);
}
function pieceHandler(
  socket,
  pieces,
  queue,
  torrent,
  file,
  pieceResp,
  downloadModule,
  peerKey
) {
  // Don't process pieces if paused
  if (downloadModule && downloadModule.isPaused && downloadModule.isPaused()) {
    return;
  }
  
  // Mark that we're receiving data from this peer
  if (downloadModule && peerKey) {
    downloadModule.markDataTransfer(peerKey);
  }
  pieces.addReceived(pieceResp);
  const offset =
    pieceResp.index * torrent.info["piece length"] + pieceResp.begin;
  fs.write(file, pieceResp.block, 0, pieceResp.block.length, offset, () => {});
  if (pieces.isDone()) {
    pieces.printFinalStats();
    process.stderr.write(":tada: Download completed successfully!\n");
    socket.end();
    try {
      fs.closeSync(file);
    } catch (e) {}
    // Use the download module's completion handler
    if (downloadModule && downloadModule.onDownloadComplete) {
      downloadModule.onDownloadComplete();
    } else {
      process.exit(0);
    }
  } else {
    requestPiece(socket, pieces, queue, downloadModule);
  }
}
function requestPiece(socket, pieces, queue, downloadModule) {
  // Don't request pieces if paused
  if (downloadModule && downloadModule.isPaused && downloadModule.isPaused()) {
    return null;
  }
  if (queue.choked) return null;
  while (queue.length()) {
    const pieceBlock = queue.deque();
    if (pieces.needed(pieceBlock)) {
      socket.write(message.buildRequest(pieceBlock));
      pieces.addRequested(pieceBlock);
      break;
    }
  }
}

