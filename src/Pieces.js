"use strict";
const tp = require("./torrent-parser");
const PROGRESS_BAR_WIDTH = 50;
const ANIMATION_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const UPDATE_INTERVAL_MS = 100;
module.exports = class {
  constructor(torrent) {
    function buildPiecesArray() {
      const nPieces = torrent.info.pieces.length / 20;
      const arr = new Array(nPieces).fill(null);
      return arr.map((_, i) =>
        new Array(tp.blocksPerPiece(torrent, i)).fill(false)
      );
    }
    this._requested = buildPiecesArray();
    this._received = buildPiecesArray();
    this.torrent = torrent;
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.lastDownloadedBlocks = 0;
    this.animationFrame = 0;
    this.updateInterval = null;
    this.totalBytes = this.calculateTotalBytes();
    this.startProgressDisplay();
  }
  calculateTotalBytes() {
    const totalBlocks = this._received.reduce(
      (total, blocks) => total + blocks.length,
      0
    );
    return totalBlocks * tp.BLOCK_LEN;
  }
  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }
  formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600)
      return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  startProgressDisplay() {
    // Don't start if already running
    if (this.updateInterval) {
      return;
    }
    this.updateInterval = setInterval(() => {
      this.updateDisplay();
    }, UPDATE_INTERVAL_MS);
  }
  stopProgressDisplay() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  updateDisplay() {
    const downloaded = this._received.reduce((totalBlocks, blocks) => {
      return blocks.filter((i) => i).length + totalBlocks;
    }, 0);
    const total = this._received.reduce((totalBlocks, blocks) => {
      return blocks.length + totalBlocks;
    }, 0);
    const percent = total > 0 ? (downloaded / total) * 100 : 0;
    const downloadedBytes = downloaded * tp.BLOCK_LEN;
    const currentTime = Date.now();
    const elapsedSeconds = (currentTime - this.startTime) / 1000;
    const timeSinceLastUpdate = (currentTime - this.lastUpdateTime) / 1000;
    // Calculate download speed
    let downloadSpeed = 0;
    if (timeSinceLastUpdate > 0 && timeSinceLastUpdate < 10) {
      const blocksDownloaded = downloaded - this.lastDownloadedBlocks;
      const bytesDownloaded = blocksDownloaded * tp.BLOCK_LEN;
      downloadSpeed = bytesDownloaded / timeSinceLastUpdate;
    }
    // Calculate average speed
    const averageSpeed =
      elapsedSeconds > 0 ? downloadedBytes / elapsedSeconds : 0;
    // Calculate ETA
    let eta = "--";
    if (downloadSpeed > 0 && percent < 100) {
      const remainingBytes = this.totalBytes - downloadedBytes;
      const etaSeconds = remainingBytes / downloadSpeed;
      if (etaSeconds > 0 && etaSeconds < 86400) {
        // Less than 24 hours
        eta = this.formatTime(etaSeconds);
      }
    } else if (averageSpeed > 0 && percent < 100) {
      const remainingBytes = this.totalBytes - downloadedBytes;
      const etaSeconds = remainingBytes / averageSpeed;
      if (etaSeconds > 0 && etaSeconds < 86400) {
        eta = this.formatTime(etaSeconds);
      }
    }
    // Update animation frame
    this.animationFrame = (this.animationFrame + 1) % ANIMATION_FRAMES.length;
    const spinner = ANIMATION_FRAMES[this.animationFrame];
    // Build progress bar
    const filled = Math.floor((percent / 100) * PROGRESS_BAR_WIDTH);
    const empty = PROGRESS_BAR_WIDTH - filled;
    const progressBar = "█".repeat(filled) + "░".repeat(empty);
    // Clear previous line and print new status (use clear line escape sequence)
    const statusLine =
      `\r\x1b[K${spinner} [${progressBar}] ${percent.toFixed(1)}% | ` +
      `↓ ${this.formatBytes(downloadSpeed)}/s | ` +
      `Avg: ${this.formatBytes(averageSpeed)}/s | ` +
      `ETA: ${eta} | ` +
      `${this.formatBytes(downloadedBytes)} / ${this.formatBytes(
        this.totalBytes
      )}`;
    process.stdout.write(statusLine);
    this.lastUpdateTime = currentTime;
    this.lastDownloadedBlocks = downloaded;
  }
  addRequested(pieceBlock) {
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    this._requested[pieceBlock.index][blockIndex] = true;
  }
  addReceived(pieceBlock) {
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    this._received[pieceBlock.index][blockIndex] = true;
  }
  needed(pieceBlock) {
    if (this._requested.every((blocks) => blocks.every((i) => i))) {
      this._requested = this._received.map((blocks) => blocks.slice());
    }
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    return !this._requested[pieceBlock.index][blockIndex];
  }
  resetRequestedState() {
    // Reset requested state to match received state
    // This allows pieces that were requested but not received to be requested again
    this._requested = this._received.map((blocks) => blocks.slice());
  }
  isDone() {
    return this._received.every((blocks) => blocks.every((i) => i));
  }
  printPercentDone() {
    // Display is now handled by updateDisplay() interval
    // This method is kept for compatibility but does nothing
  }
  printFinalStats() {
    this.stopProgressDisplay();
    const downloaded = this._received.reduce((totalBlocks, blocks) => {
      return blocks.filter((i) => i).length + totalBlocks;
    }, 0);
    const total = this._received.reduce((totalBlocks, blocks) => {
      return blocks.length + totalBlocks;
    }, 0);
    const percent = total > 0 ? (downloaded / total) * 100 : 0;
    const downloadedBytes = downloaded * tp.BLOCK_LEN;
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const averageSpeed =
      elapsedSeconds > 0 ? downloadedBytes / elapsedSeconds : 0;
    // Clear the progress line and print final stats
    const progressBar = "█".repeat(PROGRESS_BAR_WIDTH);
    process.stdout.write(
      `\r\x1b[K:white_check_mark: [${progressBar}] ${percent.toFixed(1)}% | ` +
        `Total: ${this.formatBytes(downloadedBytes)} | ` +
        `Time: ${this.formatTime(elapsedSeconds)} | ` +
        `Avg Speed: ${this.formatBytes(averageSpeed)}/s\n`
    );
  }
};
