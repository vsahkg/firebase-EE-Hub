import { adminDialogKind, closeAdminDialog, openAdminDialog } from './records.js';
import { callServer } from '../shared/api.js';
import { showError, showSuccess } from '../shared/feedback.js';
import { escapeHtml, milestoneOwnerTag, textCompare } from '../shared/html.js';

export function isActiveForAllocation(value) {
  if (value === undefined || value === null || value === '') return true;
  return value === true || value === 1 || ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

export function openCohortAssignments(cohortId, milestones) {
  openAdminDialog('cohort-assignments', `<div class="form-panel" role="dialog" aria-modal="true" aria-labelledby="cohort-assignments-title">
    <div class="toolbar"><h2 id="cohort-assignments-title">Assign cohort milestones</h2><button type="button" class="button secondary" data-close-admin-dialog>Close</button></div>
    <p>Choose students and milestones in cohort ${escapeHtml(cohortId)}. Missing assignments are created; compatible archived assignments are restored with their progress.</p>
    <p class="notice">Reapplying replaces assignment titles, descriptions, phases, due dates and due times with cohort values, but preserves statuses and history. Each student's anchor is used; students without one use the cohort anchor without changing their saved anchor. Ambiguous assignments and incompatible archives block the review; inspect them in Manage milestones or exclude them from the selection. If a large selection exceeds transaction limits, select fewer students or milestones and retry.</p>
    <div id="cohort-assignment-body" aria-live="polite"><p>Loading students…</p></div></div>`);
  const host = document.getElementById('cohort-assignment-body');
  if (!host) return;
  const active = function() { return adminDialogKind() === 'cohort-assignments' && document.getElementById('cohort-assignment-body') === host; };
  callServer('getCohortMembersForAdmin', cohortId).then(function(result) {
    if (!active()) return;
    const students = (result.records || []).filter(function(row) { return row.StudentId; }).sort(function(a, b) {
      return textCompare(a['Display Name'] || a.StudentId, b['Display Name'] || b.StudentId);
    });
    // Older servers return eeActive on each roster record but not the derived ID list.
    let activeIds;
    if (result.allocationActiveStudentIds === undefined) {
      activeIds = new Set(students.filter(function(row) { return isActiveForAllocation(row.eeActive); }).map(function(row) { return String(row.StudentId).trim().toLowerCase(); }));
    } else {
      if (!Array.isArray(result.allocationActiveStudentIds)) throw new Error('Allocation eligibility could not be loaded. Close and reopen to retry.');
      activeIds = new Set(result.allocationActiveStudentIds);
    }
    const activeCount = students.filter(function(row) { return activeIds.has(String(row.StudentId).trim().toLowerCase()); }).length;
    host.innerHTML = `<form id="cohort-assignment-form">
      <fieldset><legend>Students</legend><label class="check-option"><input type="checkbox" data-select-all="student"> Select all ${students.length} students</label>
      <button type="button" class="button secondary" id="select-allocation-active">Select active for allocation only (${activeCount})</button>
      <div class="cohort-assignment-options">${students.map(function(row) {
        const allocationActive = activeIds.has(String(row.StudentId).trim().toLowerCase());
        return `<label class="check-option"><input type="checkbox" name="student" value="${escapeHtml(row.StudentId)}" data-allocation-active="${allocationActive}"> ${escapeHtml(row['Display Name'] || row.StudentId)} <span class="muted">${escapeHtml(row.StudentId)} · ${allocationActive ? 'Active for allocation' : 'Not active for allocation'}</span></label>`;
      }).join('') || '<p class="muted">No students in this cohort.</p>'}</div></fieldset>
      <fieldset><legend>Milestones</legend><label class="check-option"><input type="checkbox" data-select-all="milestone" checked> Select all ${milestones.length} milestones</label>
      <div class="cohort-assignment-options">${milestones.map(function(row) {
        return `<label class="check-option"><input type="checkbox" name="milestone" value="${escapeHtml(row.milestoneId)}" checked> ${escapeHtml(row.milestoneTitle || row.milestoneId)} ${milestoneOwnerTag(row.mOwner)}</label>`;
      }).join('') || '<p class="muted">No milestones in this cohort.</p>'}</div></fieldset>
      <div class="field"><label for="assignment-mode">Action</label><select id="assignment-mode"><option value="missing">Assign missing only</option><option value="reapply">Assign missing and reapply cohort fields</option></select></div>
      <div id="cohort-assignment-preview" aria-live="polite"></div>
      <div class="toolbar"><button type="button" class="button secondary" id="cohort-assignment-review">Review changes</button><button type="submit" class="button" id="cohort-assignment-apply" disabled>Confirm and apply</button><button type="button" class="button secondary" data-close-admin-dialog>Cancel</button></div>
    </form>`;
    const form = host.querySelector('form');
    const preview = form.querySelector('#cohort-assignment-preview');
    const review = form.querySelector('#cohort-assignment-review');
    const apply = form.querySelector('#cohort-assignment-apply');
    form.querySelector('[data-close-admin-dialog]').addEventListener('click', closeAdminDialog);
    let reviewed = null;
    function invalidate() { reviewed = null; apply.disabled = true; preview.innerHTML = ''; }
    function syncSelectAll(name) {
      const box = form.querySelector('[data-select-all="' + name + '"]');
      const inputs = Array.from(form.querySelectorAll('input[name="' + name + '"]'));
      const selected = inputs.filter(function(input) { return input.checked; }).length;
      box.checked = inputs.length > 0 && selected === inputs.length;
      box.indeterminate = selected > 0 && selected < inputs.length;
    }
    form.querySelectorAll('[data-select-all]').forEach(function(box) {
      box.addEventListener('change', function() {
        form.querySelectorAll('input[name="' + box.dataset.selectAll + '"]').forEach(function(input) { input.checked = box.checked; });
        box.indeterminate = false;
        invalidate();
      });
    });
    form.querySelector('#select-allocation-active').addEventListener('click', function() {
      form.querySelectorAll('input[name="student"]').forEach(function(input) { input.checked = input.dataset.allocationActive === 'true'; });
      syncSelectAll('student');
      invalidate();
    });
    form.addEventListener('change', function(event) {
      if (event.target && (event.target.name === 'student' || event.target.name === 'milestone')) syncSelectAll(event.target.name);
      invalidate();
    });
    review.addEventListener('click', function() {
      const students = Array.from(form.querySelectorAll('input[name="student"]:checked')).map(function(input) { return input.value; });
      const ids = Array.from(form.querySelectorAll('input[name="milestone"]:checked')).map(function(input) { return input.value; });
      const mode = form.querySelector('#assignment-mode').value;
      invalidate();
      if (!students.length || !ids.length) { showError(new Error('Select at least one student and one milestone.')); return; }
      form.querySelectorAll('input, select, button').forEach(function(node) { node.disabled = true; });
      callServer('previewCohortAssignments', cohortId, students, ids, mode).then(function(result) {
        if (!active()) return;
        reviewed = { students, ids, mode, signature: result.signature };
        preview.innerHTML = `<p class="notice"><strong>Review:</strong> ${result.created} new, ${result.restored} restored, ${result.updated} updated, ${result.unchanged} unchanged. ${result.fallbackAnchors} student(s) have no personal anchor and will use the cohort anchor for new or reapplied dates. Confirm to apply these changes.</p>`;
        apply.disabled = false;
      }).catch(function(error) {
        if (active()) showError(error);
      }).finally(function() {
        if (!active()) return;
        form.querySelectorAll('input, select, button').forEach(function(node) { node.disabled = false; });
        apply.disabled = !reviewed;
      });
    });
    form.addEventListener('submit', function(event) {
      event.preventDefault();
      if (!reviewed) return;
      const selected = reviewed;
      form.querySelectorAll('input, select, button').forEach(function(node) { node.disabled = true; });
      callServer('applyCohortAssignments', cohortId, selected.students, selected.ids, selected.mode, selected.signature).then(function(result) {
        if (active()) closeAdminDialog();
        if (result.auditWarning) showError(new Error('Assignments were applied, but the completion audit entry could not be written.'));
        else showSuccess(`Assignments applied: ${result.created} new, ${result.restored} restored, ${result.updated} updated, ${result.unchanged} unchanged.`);
      }).catch(function(error) {
        if (!active()) return;
        invalidate();
        showError(new Error('Changes could not be confirmed. Review again before retrying. ' + error.message));
        form.querySelectorAll('input, select, button').forEach(function(node) { node.disabled = false; });
        apply.disabled = true;
      });
    });
  }).catch(function(error) {
    if (!active()) return;
    host.innerHTML = '<p class="notice error">Could not load students. Close and reopen to retry.</p>';
    showError(error);
  });
}
