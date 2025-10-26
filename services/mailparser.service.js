const { simpleParser } = require('mailparser');

async function parseMail(rawBuffer) {
  
  const parsed = await simpleParser(rawBuffer);
  return parsed; 
}

module.exports = { parseMail };
