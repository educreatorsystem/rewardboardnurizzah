const SHEET_ID = '1u_NyNG0ZNQWI2Fpzw7SLUbv7-jiDB11e4CsBHxrBpHM';
const SCORE_SHEET_NAME = 'Reward Scores';
const GROUP_SHEET_NAME = 'Reward Groups';
const LOG_SHEET_NAME = 'Rekod Reward';

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || '');
    const callback = String((e && e.parameter && e.parameter.callback) || '');

    if (action === 'getState') {
      const ss = SpreadsheetApp.openById(SHEET_ID);
      const payload = readStateFromSheets_(ss);
      return callback ? jsonpOutput_(callback, payload) : jsonOutput_(payload);
    }

    if (action === 'health') {
      const ss = SpreadsheetApp.openById(SHEET_ID);
      return jsonOutput_({
        ok: true,
        spreadsheetId: SHEET_ID,
        spreadsheetName: ss.getName(),
        sheets: ss.getSheets().map(function(sheet) { return sheet.getName(); })
      });
    }

    return jsonOutput_({
      ok: true,
      message: 'Reward Board Apps Script aktif.',
      spreadsheetId: SHEET_ID,
      source: 'google-sheet'
    });
  } catch (error) {
    return jsonOutput_({ ok: false, error: error.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);

    const payload = parsePayload_(e);
    const actions = payload.action === 'batch' && Array.isArray(payload.actions)
      ? payload.actions
      : [payload];

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const scoreSheet = getOrCreateSheet_(ss, SCORE_SHEET_NAME);
    const groupSheet = getOrCreateSheet_(ss, GROUP_SHEET_NAME);
    const logSheet = getOrCreateSheet_(ss, LOG_SHEET_NAME);

    ensureScoreHeader_(scoreSheet);
    ensureGroupHeader_(groupSheet);
    ensureLogHeader_(logSheet);

    const scoreTable = readScoreTable_(scoreSheet);
    const groupTable = readGroupTable_(groupSheet);
    const logRows = [];
    let scoreChanged = false;
    let groupChanged = false;

    actions.forEach(function(actionPayload) {
      if (!actionPayload || typeof actionPayload !== 'object') return;
      const result = applyActionToTables_(scoreTable, groupTable, actionPayload);
      scoreChanged = scoreChanged || result.scoreChanged;
      groupChanged = groupChanged || result.groupChanged;

      const logRow = makeLogRow_(actionPayload);
      if (logRow) logRows.push(logRow);
    });

    if (scoreChanged) writeScoreTable_(scoreSheet, scoreTable.rows);
    if (groupChanged) writeGroupTable_(groupSheet, groupTable.rows);
    if (logRows.length) appendLogRows_(logSheet, logRows);

    SpreadsheetApp.flush();

    return jsonOutput_({
      ok: true,
      rowsWritten: logRows.length,
      updatedAt: new Date().toISOString(),
      source: 'google-sheet'
    });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonOutput_({ ok: false, error: error.message });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function readStateFromSheets_(ss) {
  const scoreSheet = getOrCreateSheet_(ss, SCORE_SHEET_NAME);
  const groupSheet = getOrCreateSheet_(ss, GROUP_SHEET_NAME);
  ensureScoreHeader_(scoreSheet);
  ensureGroupHeader_(groupSheet);

  const scoreTable = readScoreTable_(scoreSheet);
  const groupTable = readGroupTable_(groupSheet);
  const scores = {};
  const groups = {};
  let latestTimestamp = 0;

  scoreTable.rows.forEach(function(row) {
    const studentId = String(row[0] || '').trim();
    if (!studentId) return;
    scores[studentId] = Math.max(0, Number(row[3] || 0));
    latestTimestamp = Math.max(latestTimestamp, toMillis_(row[4]));
  });

  groupTable.rows.forEach(function(row) {
    const className = String(row[0] || '').trim();
    if (!className) return;
    try {
      const parsed = JSON.parse(String(row[1] || '[]'));
      groups[className] = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      groups[className] = [];
    }
    latestTimestamp = Math.max(latestTimestamp, toMillis_(row[2]));
  });

  return {
    ok: true,
    initialized: true,
    scores: scores,
    groups: groups,
    revision: Date.now(),
    updatedAt: latestTimestamp ? new Date(latestTimestamp).toISOString() : '',
    source: 'google-sheet'
  };
}

function applyActionToTables_(scoreTable, groupTable, payload) {
  const action = String(payload.action || '');
  const now = new Date();
  let scoreChanged = false;
  let groupChanged = false;

  if (action === 'studentReward') {
    const studentId = String(payload.studentId || '').trim();
    if (studentId) {
      upsertScore_(scoreTable, {
        studentId: studentId,
        className: String(payload.className || ''),
        studentName: String(payload.studentName || payload.targetName || ''),
        score: Math.max(0, Number(payload.score || 0)),
        updatedAt: now
      });
      scoreChanged = true;
    }
  }

  if (action === 'groupReward') {
    const className = String(payload.className || '').trim();
    if (className && Array.isArray(payload.groups)) {
      upsertGroup_(groupTable, className, payload.groups, now);
      groupChanged = true;
    }

    if (Array.isArray(payload.affectedStudentRecords)) {
      payload.affectedStudentRecords.forEach(function(student) {
        if (!student || !student.id) return;
        upsertScore_(scoreTable, {
          studentId: String(student.id),
          className: String(student.className || className || ''),
          studentName: String(student.name || ''),
          score: Math.max(0, Number(student.score || 0)),
          updatedAt: now
        });
        scoreChanged = true;
      });
    }
  }

  if (action === 'saveGroups') {
    const className = String(payload.className || '').trim();
    if (className && Array.isArray(payload.groups)) {
      upsertGroup_(groupTable, className, payload.groups, now);
      groupChanged = true;
    }
  }

  if (action === 'resetScores') {
    scoreTable.rows.forEach(function(row) {
      row[3] = 0;
      row[4] = now;
    });
    groupTable.rows.forEach(function(row) {
      let groups = [];
      try {
        groups = JSON.parse(String(row[1] || '[]'));
      } catch (ignore) {}
      if (!Array.isArray(groups)) groups = [];
      groups.forEach(function(group) { group.stars = 0; });
      row[1] = JSON.stringify(groups);
      row[2] = now;
    });
    scoreChanged = true;
    groupChanged = true;
  }

  // Keserasian dengan frontend lama. Google Sheet tetap sumber utama.
  if (action === 'replaceState') {
    if (payload.scores && typeof payload.scores === 'object' && !Array.isArray(payload.scores)) {
      Object.keys(payload.scores).forEach(function(studentId) {
        const index = scoreTable.indexById[studentId];
        if (index !== undefined) {
          scoreTable.rows[index][3] = Math.max(0, Number(payload.scores[studentId] || 0));
          scoreTable.rows[index][4] = now;
          scoreChanged = true;
        }
      });
    }
    if (payload.groups && typeof payload.groups === 'object' && !Array.isArray(payload.groups)) {
      Object.keys(payload.groups).forEach(function(className) {
        if (!Array.isArray(payload.groups[className])) return;
        upsertGroup_(groupTable, className, payload.groups[className], now);
        groupChanged = true;
      });
    }
  }

  return { scoreChanged: scoreChanged, groupChanged: groupChanged };
}

function readScoreTable_(sheet) {
  const lastRow = sheet.getLastRow();
  const rawRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 5).getValues() : [];
  const rows = [];
  const indexById = {};

  rawRows.forEach(function(row) {
    const studentId = String(row[0] || '').trim();
    if (!studentId || indexById[studentId] !== undefined) return;
    indexById[studentId] = rows.length;
    rows.push([studentId, row[1] || '', row[2] || '', Math.max(0, Number(row[3] || 0)), row[4] || '']);
  });

  return { rows: rows, indexById: indexById };
}

function readGroupTable_(sheet) {
  const lastRow = sheet.getLastRow();
  const rawRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  const rows = [];
  const indexByClass = {};

  rawRows.forEach(function(row) {
    const className = String(row[0] || '').trim();
    if (!className || indexByClass[className] !== undefined) return;
    indexByClass[className] = rows.length;
    rows.push([className, String(row[1] || '[]'), row[2] || '']);
  });

  return { rows: rows, indexByClass: indexByClass };
}

function upsertScore_(table, record) {
  const id = String(record.studentId || '').trim();
  if (!id) return;
  const row = [
    id,
    String(record.className || ''),
    String(record.studentName || ''),
    Math.max(0, Number(record.score || 0)),
    record.updatedAt || new Date()
  ];

  const index = table.indexById[id];
  if (index === undefined) {
    table.indexById[id] = table.rows.length;
    table.rows.push(row);
  } else {
    table.rows[index] = row;
  }
}

function upsertGroup_(table, className, groups, updatedAt) {
  className = String(className || '').trim();
  if (!className) return;
  const row = [className, JSON.stringify(groups || []), updatedAt || new Date()];
  const index = table.indexByClass[className];
  if (index === undefined) {
    table.indexByClass[className] = table.rows.length;
    table.rows.push(row);
  } else {
    table.rows[index] = row;
  }
}

function writeScoreTable_(sheet, rows) {
  const oldRows = Math.max(0, sheet.getLastRow() - 1);
  if (rows.length) sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  if (oldRows > rows.length) {
    sheet.getRange(rows.length + 2, 1, oldRows - rows.length, 5).clearContent();
  }
}

function writeGroupTable_(sheet, rows) {
  const oldRows = Math.max(0, sheet.getLastRow() - 1);
  if (rows.length) sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  if (oldRows > rows.length) {
    sheet.getRange(rows.length + 2, 1, oldRows - rows.length, 3).clearContent();
  }
}

function makeLogRow_(payload) {
  const action = String(payload.action || '');
  if (action === 'replaceState' || action === 'saveGroups') return null;
  return [
    payload.timestamp || new Date().toISOString(),
    action,
    payload.type || '',
    payload.className || '',
    payload.targetName || payload.studentName || payload.groupName || '',
    Number(payload.delta || 0),
    Number(payload.score || 0),
    Array.isArray(payload.affectedStudents) ? payload.affectedStudents.join(', ') : String(payload.affectedStudents || '')
  ];
}

function appendLogRows_(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
}

function ensureScoreHeader_(sheet) {
  const expected = ['Student ID', 'Kelas', 'Nama Murid', 'Bintang', 'Updated At'];
  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  }
}

function ensureGroupHeader_(sheet) {
  const expected = ['Kelas', 'Groups JSON', 'Updated At'];
  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  }
}

function ensureLogHeader_(sheet) {
  const expected = ['Timestamp','Action','Jenis','Kelas','Sasaran','Perubahan Bintang','Jumlah Terkini','Murid Terlibat'];
  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
  }
}

function parsePayload_(e) {
  if (e && e.parameter && e.parameter.payload) {
    return JSON.parse(String(e.parameter.payload));
  }
  if (e && e.postData && e.postData.contents) {
    const raw = String(e.postData.contents || '').trim();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (ignore) {}
  }
  return {};
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function toMillis_(value) {
  if (!value) return 0;
  if (Object.prototype.toString.call(value) === '[object Date]') return value.getTime();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function jsonpOutput_(callback, data) {
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) return jsonOutput_(data);
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(data) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
