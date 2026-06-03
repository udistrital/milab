const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function normalizeIdent(identifier) {
  return identifier.replaceAll('"', '').trim();
}

function parseFkColumnsFromDbStructure(sqlText) {
  const lines = sqlText.split(/\r?\n/);

  const fkCols = new Set(); // key: `${table}.${column}`

  let currentCreateTable = null;
  let inCreateTable = false;

  let currentAlterTable = null;
  let inAlterTable = false;

  for (const rawLine of lines) {
    const line = rawLine;

    const createMatch = line.match(/^\s*CREATE\s+TABLE\s+([a-z_][a-z0-9_]*)\s*\(/i);
    if (createMatch) {
      currentCreateTable = normalizeIdent(createMatch[1]);
      inCreateTable = true;
      continue;
    }

    const alterMatch = line.match(/^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/i);
    if (alterMatch) {
      currentAlterTable = normalizeIdent(alterMatch[1]);
      inAlterTable = true;
    }

    if (inCreateTable && currentCreateTable) {
      if (/\bREFERENCES\b/i.test(line)) {
        const trimmed = line.trimStart();
        if (!/^(CONSTRAINT|REFERENCES)\b/i.test(trimmed)) {
          const colMatch = line.match(/^\s*([a-z_][a-z0-9_]*)\b/i);
          if (colMatch) {
            const col = normalizeIdent(colMatch[1]);
            if (!/^references$/i.test(col)) {
              fkCols.add(`${currentCreateTable}.${col}`);
            }
          }
        }
      }

      const fkMatch = line.match(/\bFOREIGN\s+KEY\s*\(([^)]+)\)/i);
      if (fkMatch) {
        const cols = fkMatch[1]
          .split(',')
          .map((c) => normalizeIdent(c))
          .filter(Boolean);
        for (const col of cols) {
          fkCols.add(`${currentCreateTable}.${col}`);
        }
      }

      if (/^\s*\)\s*;\s*$/.test(line)) {
        currentCreateTable = null;
        inCreateTable = false;
      }

      continue;
    }

    if (inAlterTable && currentAlterTable) {
      const fkMatch = line.match(/\bFOREIGN\s+KEY\s*\(([^)]+)\)/i);
      if (fkMatch) {
        const cols = fkMatch[1]
          .split(',')
          .map((c) => normalizeIdent(c))
          .filter(Boolean);
        for (const col of cols) {
          fkCols.add(`${currentAlterTable}.${col}`);
        }
      }

      if (/;\s*$/.test(line)) {
        currentAlterTable = null;
        inAlterTable = false;
      }
    }
  }

  return fkCols;
}

function parseColumnComments(sqlText) {
  const comments = new Map(); // key: `${table}.${column}` => comment

  const commentRegex =
    /COMMENT\s+ON\s+COLUMN\s+milab\.([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s+IS\s+'((?:''|[^'])*)'\s*;/gi;

  let match;
  while ((match = commentRegex.exec(sqlText)) !== null) {
    const table = normalizeIdent(match[1]);
    const column = normalizeIdent(match[2]);
    const comment = match[3].replaceAll("''", "'");

    comments.set(`${table}.${column}`, comment);
  }

  return comments;
}

function main() {
  const sqlPath = path.join(__dirname, '..', '..', 'sql-scripts', 'db_structure.sql');
  const sqlText = fs.readFileSync(sqlPath, 'utf8');

  const fkCols = parseFkColumnsFromDbStructure(sqlText);
  const comments = parseColumnComments(sqlText);

  const badNames = [];
  const missingComments = [];
  const badComments = [];

  for (const key of fkCols) {
    const [table, column] = key.split('.');

    if (!column.endsWith('_id')) {
      badNames.push({ table, column });
    }

    const comment = comments.get(key);
    if (!comment) {
      missingComments.push({ table, column });
      continue;
    }

    if (!/referencia\s+a/i.test(comment)) {
      badComments.push({ table, column, comment });
    }
  }

  if (badNames.length === 0 && missingComments.length === 0 && badComments.length === 0) {
    console.log('OK: FK audit checks passed (naming + comments).');
    return;
  }

  if (badNames.length > 0) {
    fail('\nFK columns not ending in _id:');
    for (const { table, column } of badNames) {
      fail(`- ${table}.${column}`);
    }
  }

  if (missingComments.length > 0) {
    fail('\nFK columns missing COMMENT ON COLUMN:');
    for (const { table, column } of missingComments) {
      fail(`- ${table}.${column}`);
    }
  }

  if (badComments.length > 0) {
    fail("\nFK columns with COMMENT not containing 'Referencia a':");
    for (const { table, column, comment } of badComments) {
      fail(`- ${table}.${column}: ${JSON.stringify(comment)}`);
    }
  }

  fail(`\nFile checked: ${path.relative(process.cwd(), sqlPath)}`);
}

main();
