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

for (const legacyResponse of [false, true]) test(`assignment selection and review work with ${legacyResponse ? 'older' : 'current'} roster responses`, async () => {
  function element(value = '') {
    return {
      value, checked: true, disabled: false, innerHTML: '', dataset: {}, listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      fire(type) { this.listeners[type]({ preventDefault() {} }); },
    };
  }
  const student = element('student@example.edu');
  student.dataset.allocationActive = 'true';
  const inactive = element('inactive@example.edu');
  inactive.dataset.allocationActive = 'false';
  const missingFlag = element('missing@example.edu');
  missingFlag.dataset.allocationActive = 'true';
  const students = [student, inactive, missingFlag];
  const selectStudents = element();
  selectStudents.dataset.selectAll = 'student';
  const selectMilestones = element();
  selectMilestones.dataset.selectAll = 'milestone';
  const selectActive = element();
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
    '#select-allocation-active': selectActive, '[data-select-all="student"]': selectStudents,
    '[data-select-all="milestone"]': selectMilestones,
  })[selector];
  form.querySelectorAll = (selector) => ({
    '[data-select-all]': [selectStudents, selectMilestones],
    'input[name="student"]': students,
    'input[name="milestone"]': [milestone],
    'input[name="student"]:checked': students.filter((input) => input.checked),
    'input[name="milestone"]:checked': milestone.checked ? [milestone] : [],
    'input, select, button': [...students, selectStudents, selectMilestones, selectActive, milestone, mode, review, apply, cancel],
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
      if (method === 'getCohortMembersForAdmin') {
        const result = { records: [{ StudentId: student.value, eeActive: ' y ' }, { StudentId: inactive.value, eeActive: false }, { StudentId: missingFlag.value }] };
        if (!legacyResponse) result.allocationActiveStudentIds = [student.value, missingFlag.value];
        return Promise.resolve(result);
      }
      return Promise.resolve({ created: 1, restored: 0, updated: 0, unchanged: 0, fallbackAnchors: 1, signature: 'reviewed' });
    },
    showError(error) { messages.push(error.message); },
    showSuccess(message) { messages.push(message); },
    escapeHtml: String, milestoneOwnerTag: () => '', textCompare: (a, b) => a.localeCompare(b),
  };
  const code = source('cohortAssignments.js').replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
  vm.runInNewContext(code, context);
  context.openCohortAssignments('2027', [{ milestoneId: 'm1' }]);
  await new Promise(setImmediate);
  assert.match(host.innerHTML, /Select active for allocation only \(2\)/);
  assert.match(host.innerHTML, /Not active for allocation/);
  selectActive.fire('click');
  assert.deepEqual(students.map((input) => input.checked), [true, false, true]);
  assert.equal(selectStudents.indeterminate, true);
  review.fire('click');
  await new Promise(setImmediate);
  assert.equal(apply.disabled, false);
  assert.match(preview.innerHTML, /1 new/);
  selectStudents.checked = true;
  selectStudents.fire('change');
  assert.deepEqual(students.map((input) => input.checked), [true, true, true]);
  assert.equal(apply.disabled, true);
  selectActive.fire('click');
  mode.value = 'reapply';
  form.fire('change');
  assert.equal(apply.disabled, true);
  form.fire('submit');
  assert.equal(calls.filter(([method]) => method === 'applyCohortAssignments').length, 0);
  review.fire('click');
  await new Promise(setImmediate);
  form.fire('submit');
  await new Promise(setImmediate);
  const [method, cohort, selectedStudents, ids, selectedMode, signature] = calls.at(-1);
  assert.deepEqual([method, cohort, Array.from(selectedStudents), Array.from(ids), selectedMode, signature], ['applyCohortAssignments', '2027', ['student@example.edu', 'missing@example.edu'], ['m1'], 'reapply', 'reviewed']);
  assert.match(messages.at(-1), /Assignments applied: 1 new/);
});

test('older roster eligibility matches allocation flag conventions', () => {
  const context = {};
  const code = source('cohortAssignments.js').replace(/^import .*;\n/gm, '').replace(/export function /g, 'function ');
  vm.runInNewContext(code, context);
  for (const value of [undefined, null, '', true, 1, '1', 'true', 'YES', ' y ']) {
    assert.equal(context.isActiveForAllocation(value), true, String(value));
  }
  for (const value of [false, 0, 'false', 'no', ' ', 'other']) {
    assert.equal(context.isActiveForAllocation(value), false, String(value));
  }
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
