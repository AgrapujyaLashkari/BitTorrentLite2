'use strict';

const download = require('./src/download');
const torrentParser = require('./src/torrent-parser');

const torrent = torrentParser.open(process.argv[2]);

const downloadController = download(torrent, torrent.info.name);

// Set up stdin for pause/resume commands
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

// Display instructions
process.stderr.write('\n:keyboard: Controls: Press "p" to pause, "r" to resume, "q" to quit\n');

process.stdin.on('data', (key) => {
  // Handle Ctrl+C
  if (key === '\u0003') {
    process.exit(0);
  }
  
  // Handle pause
  if (key === 'p' || key === 'P') {
    downloadController.pause();
  }
  
  // Handle resume
  if (key === 'r' || key === 'R') {
    downloadController.resume();
  }
  
  // Handle quit
  if (key === 'q' || key === 'Q') {
    process.stderr.write('\n:wave: Quitting...\n');
    downloadController.cleanup();
    process.exit(0);
  }
});