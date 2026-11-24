import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { state } from '../shared/state.js';
import { staffStudentDrawersHtml } from '../shared/studentDrawers.js';
import { bindCohortJourney, rememberStaffViewMode, renderCohortJourney, renderListJourney, renderStaffStudentList, staffJourneyPhases, staffViewMode, staffViewModeControl } from './students.js';

const home = {
  canEditMilestones: false,
  templates: [{ milestoneId: 'm1', phase: 'p1', title: 'Proposal', type: 'task' }],
  phases: [{ phaseId: 'p1', phaseTitle: 'Inquiry', phaseColor: '#004C80' }],
};

const student = {
  email: 'amy@school.edu',
  displayName: 'Amy Chen',
  surname: 'Chen',
  subject: 'Biology',
  hrm: '12A',
  studentNumber: '1001',
  segments: 'o',
  dues: ['2026-11-01'],
  done: 0,
  total: 1,
  behind: 0,
  waiting: [],
  latestTitle: 'Proposal',
};

test('one viewMode control offers Tiles, List collapsed, and List expanded', () => {
  state.staffViewMode = 'list-collapsed';
  assert.equal(staffViewMode(), 'list-collapsed');
  const control = staffViewModeControl();
  assert.match(control, /role="group" aria-label="Student layout"/);
  assert.match(control, /data-staff-view="tiles" aria-pressed="false"/);
  assert.match(control, /data-staff-view="list-collapsed" aria-pressed="true"/);
  assert.match(control, /data-staff-view="list-expanded" aria-pressed="false"/);
  assert.match(control, />Tiles</);
  assert.match(control, />List collapsed</);
  assert.match(control, />List expanded</);
  assert.equal((control.match(/data-staff-view=/g) || []).length, 3);
  rememberStaffViewMode('list-expanded');
  assert.equal(staffViewMode(), 'list-expanded');
  rememberStaffViewMode('somewhere-else');
  assert.equal(staffViewMode(), 'tiles');
});

test('cohort journey groups visible students by date and time and escapes names', () => {
  const journeyHome = { ...home, templates: [{ ...home.templates[0], mOwner: 'supervisor', description: 'Review' }] };
  const students = [
    { displayName: 'Amy <Chen>', assigned: [{ templateId: 'm1', due: '2026-11-01', dueTime: '15:00' }] },
    { displayName: 'Bob', assigned: [{ templateId: 'm1', due: '2026-11-01', dueTime: '15:00' }] },
    { displayName: 'Carol', assigned: [{ templateId: 'm1', due: '2026-11-02' }] },
    { displayName: 'Dan', assigned: [] },
  ];
  const html = renderCohortJourney(journeyHome, students);
  assert.match(html, /milestone-owner">Supervisor/);
  assert.match(html, /1 Nov 2026 · 15:00 HKT · 2 students/);
  assert.match(html, /2 Nov 2026 · 1 student/);
  assert.match(html, /Not assigned · 1 student/);
  assert.match(html, /Amy &lt;Chen&gt;/);
  assert.doesNotMatch(html, /<details open/);
});

test('cohort journey can be closed by button or Escape, restoring focus', () => {
  function element() {
    return {
      listeners: {}, attributes: {}, focused: false,
      addEventListener(type, handler) { this.listeners[type] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { this.focused = true; },
    };
  }
  const drawer = element();
  const open = element();
  const close = element();
  bindCohortJourney(drawer, open, close);
  open.listeners.click();
  assert.equal(drawer.hidden, false);
  assert.equal(open.attributes['aria-expanded'], 'true');
  assert.equal(close.focused, true);
  close.listeners.click();
  assert.equal(drawer.hidden, true);
  assert.equal(open.attributes['aria-expanded'], 'false');
  assert.equal(open.focused, true);
  open.listeners.click();
  drawer.listeners.keydown({ key: 'Escape' });
  assert.equal(drawer.hidden, true);
  assert.equal(open.attributes['aria-expanded'], 'false');
});

test('cohort journey header stays below the sticky topbar', () => {
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.cohort-journey-drawer:not\(\[hidden\]\)\s*\{[^}]*top:\s*var\(--topbar-height,\s*40px\)/);
});

test('list rows follow viewMode and the column no longer has its own expand button', () => {
  state.staffViewMode = 'list-collapsed';
  const collapsed = renderStaffStudentList(home, [student]);
  assert.match(collapsed, /list-journey is-collapsed/);
  assert.equal(collapsed.includes('data-list-journey-toggle'), false);
  assert.equal(collapsed.includes('>Expand<'), false);
  state.staffViewMode = 'list-expanded';
  const expanded = renderStaffStudentList(home, [student]);
  assert.match(expanded, /list-journey is-expanded/);
  assert.equal(expanded.includes('data-list-journey-toggle'), false);
  assert.equal(expanded.includes('>Collapse<'), false);
});

test('both list views show phases and milestones in left-to-right chronological order', () => {
  const data = {
    phases: [
      { phaseId: 'later', phaseTitle: 'Later phase', sequence: 2 },
      { phaseId: 'early', phaseTitle: 'Early phase', sequence: 1 },
    ],
    templates: [
      { milestoneId: 'late', phase: 'early', title: 'Late date' },
      { milestoneId: 'morning', phase: 'early', title: 'Morning' },
      { milestoneId: 'undated', phase: 'early', title: 'Undated' },
      { milestoneId: 'afternoon', phase: 'early', title: 'Afternoon' },
      { milestoneId: 'last', phase: 'later', title: 'Final' },
    ],
  };
  const person = {
    segments: 'doooo',
    assigned: [
      { templateId: 'late', due: '2027-02-02' },
      { templateId: 'morning', due: '2027-02-01', dueTime: '09:00' },
      { templateId: 'afternoon', due: '2027-02-01', dueTime: '15:00' },
      { templateId: 'last', due: '2027-03-01' },
    ],
  };
  const phases = staffJourneyPhases(data, person);
  assert.deepEqual(phases.map((phase) => phase.id), ['early', 'later']);
  assert.deepEqual(phases[0].milestones.map((milestone) => [milestone.id, milestone.done]), [
    ['morning', false], ['afternoon', false], ['late', true], ['undated', false],
  ]);
  for (const mode of ['list-collapsed', 'list-expanded']) {
    state.staffViewMode = mode;
    const html = renderListJourney(data, person);
    const body = html.slice(html.indexOf('<ol'));
    for (const label of ['Morning', 'Afternoon', 'Late date', 'Undated', 'Early phase', 'Later phase', 'Final']) {
      assert.ok(body.includes(label), `${mode} is missing ${label}`);
    }
    assert.ok(body.indexOf('Morning') < body.indexOf('Afternoon'));
    assert.ok(body.indexOf('Afternoon') < body.indexOf('Late date'));
    assert.ok(body.indexOf('Late date') < body.indexOf('Undated'));
    assert.ok(body.indexOf('Early phase') < body.indexOf('Later phase'));
    assert.ok(body.indexOf('Undated') < body.indexOf('Final'));
  }
});

test('staff student drawers keep Notes and leave Journey to the carousel', () => {
  const collapsed = staffStudentDrawersHtml({ notesOpen: false });
  assert.match(collapsed, /id="side-drawers" class="side-drawers"/);
  assert.equal(collapsed.includes('Student Journey'), false);
  assert.equal(collapsed.includes('id="journey-panel"'), false);
  assert.equal(collapsed.includes('id="journey-drawer"'), false);
  assert.match(collapsed, /class="notes-peek"[^>]*>Notes</);
  const open = staffStudentDrawersHtml({ notesOpen: true });
  assert.match(open, /id="notes-panel" class="notes-panel open"/);
  assert.match(open, /<strong>Notes<\/strong>/);
  assert.equal(open.includes('id="journey-panel"'), false);
  assert.equal(open.includes('id="journey-drawer"'), false);
});
