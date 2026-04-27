const fs = require('fs');
const path = require('path');

const publicGenerateDir = path.join(__dirname, '..', 'public', 'generate');
const privateGenerateDir =
  process.env.PRIVATE_GENERATE_DIR || path.join(__dirname, '..', 'private', 'generate');
const usePrivateGenerateDir = process.env.PRIVATE_GENERATE_DIR_ENABLED === 'true';

const generateDir = usePrivateGenerateDir ? privateGenerateDir : publicGenerateDir;

fs.mkdirSync(generateDir, { recursive: true });

function buildGeneratePath(fileName) {
  return path.join(generateDir, fileName);
}

module.exports = {
  buildGeneratePath,
  generateDir,
  usePrivateGenerateDir,
};
