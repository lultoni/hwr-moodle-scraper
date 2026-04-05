// Tests for assignment feedback extraction.
// src/scraper/assign.ts

import { describe, it, expect } from "vitest";
import { extractAssignmentFeedback } from "../../src/scraper/assign.js";

const BASE = "https://moodle.example.com";

describe("extractAssignmentFeedback — unit tests", () => {
  it("returns null when no submission status section is present", () => {
    const html = `<html><body><div class="generaltable">No assignment content</div></body></html>`;
    expect(extractAssignmentFeedback(html, BASE)).toBeNull();
  });

  it("extracts grade from grading summary table", () => {
    const html = `<html><body>
      <div class="submissionstatustable">
        <table class="generaltable">
          <tr><th>Bewertung</th><td>85,00 / 100,00</td></tr>
        </table>
      </div>
    </body></html>`;
    const result = extractAssignmentFeedback(html, BASE);
    expect(result).not.toBeNull();
    expect(result?.grade).toContain("85");
  });

  it("extracts feedback comment HTML", () => {
    const html = `<html><body>
      <div class="submissionstatustable">
        <div class="gradingform_comments">
          <div class="editor_feedback"><p>Sehr gute Arbeit! Nur die Einleitung war etwas kurz.</p></div>
        </div>
      </div>
    </body></html>`;
    const result = extractAssignmentFeedback(html, BASE);
    expect(result).not.toBeNull();
    expect(result?.feedbackHtml).toContain("Sehr gute Arbeit");
  });

  it("extracts submission file URLs from the submission area", () => {
    const html = `<html><body>
      <div class="submissionstatustable">
        <div class="fileuploadsubmission">
          <a href="${BASE}/pluginfile.php/123/assignsubmission_file/submission_files/456/Hausarbeit.pdf">
            Hausarbeit.pdf
          </a>
        </div>
      </div>
    </body></html>`;
    const result = extractAssignmentFeedback(html, BASE);
    expect(result).not.toBeNull();
    expect(result?.submissionUrls).toHaveLength(1);
    expect(result?.submissionUrls[0]).toContain("Hausarbeit.pdf");
  });

  it("returns empty submissionUrls when no file was submitted", () => {
    const html = `<html><body>
      <div class="submissionstatustable">
        <table class="generaltable">
          <tr><th>Einreichungsstatus</th><td>Keine Einreichung</td></tr>
        </table>
      </div>
    </body></html>`;
    const result = extractAssignmentFeedback(html, BASE);
    // Could be null or an object with empty arrays — both acceptable
    if (result !== null) {
      expect(result.submissionUrls).toHaveLength(0);
    }
  });

  it("returns null for grade when assignment is not yet graded", () => {
    const html = `<html><body>
      <div class="submissionstatustable">
        <div class="fileuploadsubmission">
          <a href="${BASE}/pluginfile.php/1/assignsubmission_file/submission_files/1/file.pdf">file.pdf</a>
        </div>
      </div>
    </body></html>`;
    const result = extractAssignmentFeedback(html, BASE);
    expect(result).not.toBeNull();
    expect(result?.grade).toBeNull();
  });

  it("extracts online text submission from full_assignsubmission_onlinetext div", () => {
    const html = `<html><body>
      <div class="submissionstatustable">
        <div class="box hidefull full_assignsubmission_onlinetext_849062">
          <div class="no-overflow"><p>Meine Abgabe als Online-Text.</p><ul><li>Punkt 1</li></ul></div>
        </div>
      </div>
    </body></html>`;
    const result = extractAssignmentFeedback(html, BASE);
    expect(result).not.toBeNull();
    expect(result?.submissionTextHtml).toContain("Meine Abgabe");
    expect(result?.submissionTextHtml).toContain("Punkt 1");
  });

  it("returns null for submissionTextHtml when no online text submission present", () => {
    const html = `<html><body>
      <div class="submissionstatustable">
        <a href="${BASE}/pluginfile.php/1/assignsubmission_file/submission_files/1/file.pdf">file.pdf</a>
      </div>
    </body></html>`;
    const result = extractAssignmentFeedback(html, BASE);
    expect(result?.submissionTextHtml ?? null).toBeNull();
  });
});
