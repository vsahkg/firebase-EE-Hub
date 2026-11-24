import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const adminDir = path.dirname(fileURLToPath(import.meta.url));

test('cohort pathway reset warns about archived progress and requires confirmation', () => {
  const html = source('pathway.js');
  assert.match(html, /will be archived with their progress/);
  assert.match(html, /original phase and milestone/);
  assert.match(html, /Legacy assignments without a cohort ID/);
  assert.match(html, /id="pathway-reset-confirm" type="checkbox" required/);
  assert.match(source('records.js'), /kind === 'pathway-reset'/);
});

test('assignment review is invalidated by selection changes before applying', async () => {
  function element(value = '') {
    return {
      value, checked: true, disabled: false, innerHTML: '', dataset: {}, listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      fire(type) { this.listeners[type]({ preventDefault() {} }); },
    };
  }
  const student = element('student@example.edu');
  const milestone = element('m1');
  const mode = element('missing');
  const preview = element();
  const review = element();
  const apply = element();
  const cancel = element();
  const form = element();
  form.querySelector = (selector) => ({
    '#cohort-assignment-preview': preview, '#cohort-assignment-review': review,
    '#cohort-assignment-apply': apply, '#assignment-mode': mode, '[data-close-admin-dialog]': cancel,
  })[selector];
  form.querySelectorAll = (selector) => ({
    '[data-select-all]': [],
    'input[name="student"]:checked': student.checked ? [student] : [],
    'input[name="milestone"]:checked': milestone.checked ? [milestone] : [],
    'input, select, button': [student, milestone, mode, review, apply, cancel],
  })[selector] || [];
  const host = { innerHTML: '', querySelector: () => form };
  const calls = [];
  const messages = [];
  let open = true;
  const context = {
    document: { getElementById: () => host },
    openAdminDialog() {},
    adminDialogKind: () => open ? 'cohort-assignments' : '',
    closeAdminDialog: () => { open = false; },
    callServer(method, ...args) {
      calls.push([method, ...args]);
      if (method === 'getCohortMembersForAdmin') return Promise.resolve({ records: [{ StudentId: student.value }] });
      return Promise.resolve({ created: 1, restored: 0, updated: 0, unchanged: 0, fallbackAnchors: 1, signature: 'reviewed' });
    },
    showError(error) { messages.push(error.message); },
    showSuccess(message) { messages.push(message); },
    escapeHtml: String, milestoneOwnerTag: () => '', textCompare: (a, b) => a.localeCompare(b),
  };
  const code = source('cohortAssignments.js').replace(/^import .*;\n/gm, '').replace('export function ', 'function ');
  vm.runInNewContext(code, context);
  context.openCohortAssignments('2027', [{ milestoneId: 'm1' }]);
  await new Promise(setImmediate);
  review.fire('click');
  await new Promise(setImmediate);
  assert.equal(apply.disabled, false);
  assert.match(preview.innerHTML, /1 new/);
  mode.value = 'reapply';
  form.fire('change');
  assert.equal(apply.disabled, true);
  form.fire('submit');
  assert.equal(calls.filter(([method]) => method === 'applyCohortAssignments').length, 0);
  review.fire('click');
  await new Promise(setImmediate);
  form.fire('submit');
  await new Promise(setImmediate);
  const [method, cohort, students, ids, selectedMode, signature] = calls.at(-1);
  assert.deepEqual([method, cohort, Array.from(students), Array.from(ids), selectedMode, signature], ['applyCohortAssignments', '2027', ['student@example.edu'], ['m1'], 'reapply', 'reviewed']);
  assert.match(messages.at(-1), /Assignments applied: 1 new/);
});

function source(name) {
  return fs.readFileSync(path.join(adminDir, name), 'utf8');
}

test('admin pages do not render their own cohort dropdowns', function() {
  const files = fs.readdirSync(adminDir).filter((name) => name.endsWith('.js'));
  const hits = [];
  files.forEach((name) => {
    const text = source(name);
    const match = text.match(/<select[^>]*id="[^"]*cohort[^"]*"/i);
    if (match) hits.push(name + ' ' + match[0]);
    ['assignment-cohort', 'admin-cohort', 'quota-cohort', 'notice-cohort', 'plan-cohort', 'import-cohort'].forEach((id) => {
      if (text.includes('id="' + id + '"')) hits.push(name + ' still has ' + id);
    });
  });
  assert.deepEqual(hits, []);
});

test('the assignments admin screen is now Student Tasks backed by studentActionItems', function() {
  const sections = source('sections.js');
  const tasks = source('studentTasks.js');
  const records = source('records.js');
  assert.match(sections, /\['studentTasks', 'Student Tasks'\]/);
  assert.doesNotMatch(sections, /Assignments/);
  assert.match(tasks, /listStudentTasks/);
  assert.match(tasks, /adoptGlobalCohort/);
  assert.match(records, /saveStudentTask/);
  assert.match(records, /deleteStudentTask/);
  assert.equal(fs.existsSync(path.join(adminDir, 'assignments.js')), false);
});
