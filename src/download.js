'use strict';

const fs = require('fs');
const net = require('net');
const tracker = require('./tracker');
const message = require('./message');
const Pieces = require('./Pieces');
const Queue = require('./Queue');

const DEFAULT_INTERVAL_SECONDS = 1800; // 30 minutes default if tracker doesn't specify
const MIN_INTERVAL_SECONDS = 60; // Minimum 1 minute to avoid excessive requests

module.exports = (torrent, path) => {
  const pieces = new Pieces(torrent);
  const file = fs.openSync(path, 'w');
  const connectedPeers = new Set();
  let peerDiscoveryInterval = null;

  function connectToPeers(peers, interval) {
    // Stop peer discovery if download is complete
    if (pieces.isDone()) {
      if (peerDiscoveryInterval) {
        clearInterval(peerDiscoveryInterval);
        peerDiscoveryInterval = null;
        console.log('✅ Download complete, stopping peer discovery');
      }
      return;
    }

    const newPeers = peers.filter(peer => {
      const peerKey = `${peer.ip}:${peer.port}`;
      return !connectedPeers.has(peerKey);
    });

    if (newPeers.length > 0) {
      console.log(`🔗 Attempting to connect to ${newPeers.length} new peers...`);
      newPeers.forEach(peer => {
        const peerKey = `${peer.ip}:${peer.port}`;
        connectedPeers.add(peerKey);
        download(peer, torrent, pieces, file, () => {
          connectedPeers.delete(peerKey);
        });
      });
    } else {
      console.log('ℹ️  No new peers to connect to');
    }

    // Set up periodic peer discovery if interval is provided
    if (interval && !peerDiscoveryInterval) {
      const intervalMs = Math.max(interval * 1000, MIN_INTERVAL_SECONDS * 1000);
      console.log(`⏰ Setting up periodic peer discovery every ${interval / 60} minutes`);
      
      peerDiscoveryInterval = setInterval(() => {
        // Check if download is complete before discovering more peers
        if (pieces.isDone()) {
          clearInterval(peerDiscoveryInterval);
          peerDiscoveryInterval = null;
          console.log('✅ Download complete, stopping peer discovery');
          return;
        }
        console.log('🔄 Discovering more peers...');
        tracker.getPeers(torrent, (newPeers, newInterval) => {
          connectToPeers(newPeers, newInterval || interval);
        });
      }, intervalMs);
    }
  }

  // Initial peer discovery
  tracker.getPeers(torrent, (peers, interval) => {
    connectToPeers(peers, interval || DEFAULT_INTERVAL_SECONDS);
  });
};

function download(peer, torrent, pieces, file, onDisconnect) {
  const socket = new net.Socket();
  socket.on('error', (err) => {
    console.log(`❌ Connection to ${peer.ip}:${peer.port} failed:`, err.message);
    if (onDisconnect) onDisconnect();
  });
  socket.on('close', () => {
    if (onDisconnect) onDisconnect();
  });
  socket.connect(peer.port, peer.ip, () => {
    console.log(`✅ Connected to peer: ${peer.ip}:${peer.port}`);
    socket.write(message.buildHandshake(torrent));
  });
  const queue = new Queue(torrent);
  onWholeMsg(socket, msg => msgHandler(msg, socket, pieces, queue, torrent, file));
}

function onWholeMsg(socket, callback) {
  let savedBuf = Buffer.alloc(0);
  let handshake = true;

  socket.on('data', recvBuf => {
    // msgLen calculates the length of a whole message
    const msgLen = () => handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
    savedBuf = Buffer.concat([savedBuf, recvBuf]);

    while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
      callback(savedBuf.slice(0, msgLen()));
      savedBuf = savedBuf.slice(msgLen());
      handshake = false;
    }
  });
}

function msgHandler(msg, socket, pieces, queue, torrent, file) {
  if (isHandshake(msg)) {
    socket.write(message.buildInterested());
  } else {
    const m = message.parse(msg);

    if (m.id === 0) chokeHandler(socket);
    if (m.id === 1) unchokeHandler(socket, pieces, queue);
    if (m.id === 4) haveHandler(socket, pieces, queue, m.payload);
    if (m.id === 5) bitfieldHandler(socket, pieces, queue, m.payload);
    if (m.id === 7) pieceHandler(socket, pieces, queue, torrent, file, m.payload);
  }
}

function isHandshake(msg) {
  return msg.length === msg.readUInt8(0) + 49 &&
         msg.toString('utf8', 1, 20) === 'BitTorrent protocol';
}

function chokeHandler(socket) {
  socket.end();
}

function unchokeHandler(socket, pieces, queue) {
  queue.choked = false;
  requestPiece(socket, pieces, queue);
}

function haveHandler(socket, pieces, queue, payload) {
  const pieceIndex = payload.readUInt32BE(0);
  const queueEmpty = queue.length === 0;
  queue.queue(pieceIndex);
  if (queueEmpty) requestPiece(socket, pieces, queue);
}

function bitfieldHandler(socket, pieces, queue, payload) {
  const queueEmpty = queue.length === 0;
  payload.forEach((byte, i) => {
    for (let j = 0; j < 8; j++) {
      if (byte % 2) queue.queue(i * 8 + 7 - j);
      byte = Math.floor(byte / 2);
    }
  });
  if (queueEmpty) requestPiece(socket, pieces, queue);
}

function pieceHandler(socket, pieces, queue, torrent, file, pieceResp) {
  pieces.printPercentDone();

  pieces.addReceived(pieceResp);

  const offset = pieceResp.index * torrent.info['piece length'] + pieceResp.begin;
  fs.write(file, pieceResp.block, 0, pieceResp.block.length, offset, () => {});

  if (pieces.isDone()) {
    console.log('DONE!');
    socket.end();
    try { fs.closeSync(file); } catch(e) {}
  } else {
    requestPiece(socket,pieces, queue);
  }
}

function requestPiece(socket, pieces, queue) {
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