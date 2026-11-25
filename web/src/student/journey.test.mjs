import assert from 'node:assert/strict';
import test from 'node:test';
import { state } from '../shared/state.js';
import {
  bindJourney,
  bindJourneyDisclosures,
  journeyHereCard,
  journeyOverview,
  paintStudentJourney,
  renderJourneyMilestone,
  renderJourneyPhase,
  renderJourneyTodo,
} from './journey.js';

const template = { milestoneId: 'm1', title: 'Review', type: 'approval', phase: 'p1', mOwner: 'supervisor' };
const item = { TaskId: 'task1', TemplateId: 'm1', Title: 'Review', Description: 'Review the question', Status: 'Pending', canUpdate: true, staffUpdate: true };
const todo = { TaskId: 'todo1', Title: 'Read sources', Description: 'Read a chapter', Status: 'Pending', canEdit: true };
const home = { email: 'student@example.com', cohort: '2027', staffView: true, canUpdateMilestones: true, templates: [template], phases: [{ phaseId: 'p1', phaseTitle: 'Research' }], actionItems: [item] };

test('milestone and to-do headers start collapsed and retain their controls in details', () => {
  state.journeyExpanded = {};
  state.editingTodo = '';
  const milestone = renderJourneyMilestone(home, template, item, { template, item });
  assert.match(milestone, /data-journey-toggle="milestone:m1" aria-expanded="false"/);
  assert.match(milestone, /data-journey-details hidden[\s\S]*Review the question[\s\S]*data-decide="approve"[\s\S]*data-edit-milestone/);
  assert.match(milestone, /data-milestone-check/);
  const task = renderJourneyTodo(todo);
  assert.match(task, /data-journey-toggle="todo:todo1" aria-expanded="false"/);
  assert.match(task, /data-journey-details hidden[\s\S]*Read a chapter[\s\S]*data-edit-todo/);
  const current = journeyHereCard(home, { template, item }, { p1: 'Research' }, 'all', 'p1');
  assert.match(current, /data-journey-toggle="milestone:m1" aria-expanded="false"/);
  assert.match(current, /data-journey-details hidden[\s\S]*Review the question/);
});

test('student owner filter hides other milestone owners in both journey views', () => {
  state.journeyExpanded = {};
  state.journeyFilters = { phaseId: 'all', showSystem: true, showStudent: true, owner: 'student' };
  const studentTemplate = { ...template, milestoneId: 'm2', title: 'Write', mOwner: 'student' };
  const record = { ...home, templates: [template, studentTemplate] };
  assert.deepEqual(journeyOverview(record)[0].milestones.map((entry) => entry.id), ['m2']);
  const html = renderJourneyPhase(record, record.phases[0], {}, null, 'all', 'p1');
  assert.match(html, /Write/);
  assert.doesNotMatch(html, />Review</);
  assert.match(html, /milestone-owner">Student/);
  state.journeyFilters.owner = 'all';
  assert.equal(journeyOverview(record)[0].milestones.length, 2);
});

test('milestone due time is shown when present', () => {
  state.journeyExpanded = {};
  assert.match(renderJourneyMilestone(home, template, { ...item, DueDate: '2027-01-02', DueTime: '15:30' }, null), /2 Jan 2027 · 15:30 HKT/);
  assert.doesNotMatch(renderJourneyMilestone(home, template, { ...item, DueDate: '2027-01-02' }, null), /HKT/);
});

test('checking an assigned milestone sends its task id and can be undone', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.document = { getElementById() { return null; }, querySelectorAll() { return []; } };
  globalThis.window = { eeCall(method, args) { calls.push([method, args]); return Promise.resolve({}); } };
  try {
    const record = { ...home, staffView: false, canUpdateMilestones: false, actionItems: [{ ...item, CreatorType: 'System' }] };
    state.user = { role: 'student', email: record.email };
    state.studentHome = record;
    state.journeySync = {};
    state.mutationQueues = {};
    const card = { dataset: { taskId: 'task1', milestoneId: 'm1' } };
    const box = {
      dataset: { milestoneId: 'm1' }, checked: true, disabled: false,
      closest(selector) { return selector === '[data-task-id]' ? card : this; },
      addEventListener(event, callback) { this.change = callback; },
    };
    const host = {
      id: 'journey-module', innerHTML: '',
      querySelector() { return null; },
      querySelectorAll(selector) { return selector === '[data-milestone-check]' ? [box] : []; },
    };
    bindJourney(host, record, 'p1');
    box.change();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls[0], ['setActionItemStatus', ['task1', 'Completed', '', '2027', '']]);
    assert.equal(record.actionItems[0].Status, 'Completed');
    box.checked = false;
    box.change();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls[1][1][1], 'Pending');
    assert.equal(record.actionItems[0].Status, 'Pending');
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    state.user = null;
    state.studentHome = null;
  }
});

test('missing milestones are checkable only when the server grants status access', () => {
  const permitted = renderJourneyMilestone({ ...home, canUpdateMilestones: false }, { ...template, canUpdateStatus: true }, null, null);
  const denied = renderJourneyMilestone({ ...home, canUpdateMilestones: false }, { ...template, canUpdateStatus: false }, null, null);
  assert.match(permitted, /data-milestone-check[^>]*aria-label/);
  assert.doesNotMatch(permitted, /data-milestone-check[^>]*disabled/);
  assert.match(denied, /data-milestone-check[^>]*disabled/);
});

test('checking a missing student milestone creates it and refreshes the journey', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const calls = [];
  const record = { ...home, staffView: false, canUpdateMilestones: false, templates: [{ ...template, mOwner: 'student', canUpdateStatus: true }], actionItems: [] };
  const fresh = { ...record, actionItems: [{ ...item, CreatorType: 'System', Status: 'Completed' }] };
  globalThis.document = { getElementById() { return null; }, querySelectorAll() { return []; } };
  globalThis.window = { eeCall(method, args) { calls.push([method, args]); return Promise.resolve(method === 'getStudentHome' ? fresh : {}); } };
  try {
    state.user = { role: 'student', email: record.email };
    state.studentHome = record;
    state.journeySync = {};
    state.mutationQueues = {};
    const box = {
      dataset: { milestoneId: 'm1' }, checked: true, disabled: false,
      closest() { return { dataset: { taskId: '', milestoneId: 'm1' } }; },
      addEventListener(event, callback) { this.change = callback; },
    };
    const host = {
      id: 'journey-module', innerHTML: '',
      querySelector() { return null; },
      querySelectorAll(selector) { return selector === '[data-milestone-check]' ? [box] : []; },
    };
    bindJourney(host, record, 'p1');
    box.change();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls.map((entry) => entry[0]), ['setStaffMilestoneStatus', 'getStudentHome']);
    assert.equal(state.studentHome, fresh);
    assert.equal(fresh.actionItems[0].Status, 'Completed');
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    state.user = null;
    state.studentHome = null;
  }
});

test('disclosures toggle independently and synchronize both copies of a milestone', () => {
  state.journeyExpanded = {};
  function button(key) {
    const details = { hidden: true };
    const attributes = { 'aria-expanded': 'false' };
    return {
      dataset: { journeyToggle: key },
      details,
      getAttribute(name) { return attributes[name]; },
      setAttribute(name, value) { attributes[name] = value; },
      closest() { return { querySelector() { return details; } }; },
      addEventListener(event, callback) { this.click = callback; },
    };
  }
  const first = button('milestone:m1');
  const duplicate = button('milestone:m1');
  const other = button('todo:todo1');
  bindJourneyDisclosures({ querySelectorAll() { return [first, duplicate, other]; } });
  first.click();
  assert.equal(first.details.hidden, false);
  assert.equal(duplicate.details.hidden, false);
  assert.equal(duplicate.getAttribute('aria-expanded'), 'true');
  assert.equal(other.details.hidden, true);
  assert.match(renderJourneyMilestone(home, template, item, null), /aria-expanded="true"[\s\S]*data-journey-details>/);
  duplicate.click();
  assert.equal(first.details.hidden, true);
  assert.equal(first.getAttribute('aria-expanded'), 'false');
  assert.equal(state.journeyExpanded['milestone:m1'], undefined);
  other.click();
  state.editingTodo = 'todo1';
  assert.match(renderJourneyTodo(todo), /aria-expanded="true"[\s\S]*data-todo-title/);
});

test('a different student or view starts collapsed after a repaint', () => {
  const host = { id: 'journey-module', innerHTML: '', querySelectorAll() { return []; }, querySelector() { return null; } };
  state.journeySync = {};
  state.journeyFilters = { phaseId: 'all', showSystem: true, showStudent: true };
  state.journeyDisclosureIdentity = '';
  paintStudentJourney(home, host);
  state.journeyExpanded['milestone:m1'] = true;
  paintStudentJourney(home, host);
  assert.match(host.innerHTML, /data-journey-toggle="milestone:m1" aria-expanded="true"/);
  paintStudentJourney({ ...home, email: 'another@example.com' }, host);
  assert.match(host.innerHTML, /data-journey-toggle="milestone:m1" aria-expanded="false"/);
  state.journeyExpanded['milestone:m1'] = true;
  paintStudentJourney({ ...home, staffView: false }, host);
  assert.match(host.innerHTML, /data-journey-toggle="milestone:m1" aria-expanded="false"/);
});
