// Assignment feedback and submission extraction.
// Parses the assignment view page (mod/assign/view.php?id=N) to extract:
//   - grade (if graded)
//   - feedback comment from the grader
//   - URLs of the student's own submitted files
//   - URLs of teacher-attached introattachment files
//   - online text submission (assignsubmission_onlinetext)

export interface AssignmentFeedback {
  /** Grade string as shown in Moodle (e.g. "85,00 / 100,00"), or null if not yet graded. */
  grade: string | null;
  /** Raw inner HTML of the feedback comment block, or null if no feedback. */
  feedbackHtml: string | null;
  /** URLs of the student's own submission files (pluginfile.php links, assignsubmission paths). */
  submissionUrls: string[];
  /** URLs of teacher-attached files (pluginfile.php links, mod_assign/introattachment paths). */
  introattachmentUrls: string[];
  /** Raw inner HTML of an online text submission, or null if none. */
  submissionTextHtml: string | null;
}

/**
 * Extract assignment feedback from the assignment view page HTML.
 * Returns null if the page does not contain a submission status section
 * (i.e., not an assignment page or no submission yet).
 */
export function extractAssignmentFeedback(html: string, _baseUrl: string): AssignmentFeedback | null {
  // Only process pages that contain a submission status section
  if (!html.includes("submissionstatustable")) return null;

  // --- Grade extraction ---
  // Moodle shows grade in a <table class="generaltable"> row:
  // <tr><th>Bewertung</th><td>85,00 / 100,00</td></tr>  (German)
  // <tr><th>Grade</th><td>85.00 / 100.00</td></tr>       (English)
  let grade: string | null = null;
  const gradeRe = /<th[^>]*>(?:Bewertung|Grade|Note)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i;
  const gradeM = gradeRe.exec(html);
  if (gradeM?.[1]) {
    const raw = gradeM[1].replace(/<[^>]+>/g, "").trim();
    if (raw && !/keine|no grade|nicht/i.test(raw)) grade = raw;
  }

  // --- Feedback HTML extraction ---
  // Feedback comment is in <div class="gradingform_comments"> or <div class="editor_feedback">
  let feedbackHtml: string | null = null;
  const fbRe = /<div[^>]+class="[^"]*(?:gradingform_comments|editor_feedback|feedback_editor)[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const fbM = fbRe.exec(html);
  if (fbM?.[1]) {
    const inner = fbM[1].replace(/<[^>]+>/g, "").trim();
    if (inner) feedbackHtml = fbM[1];
  }

  // --- Online text submission ---
  // Student's online text is in: <div class="... full_assignsubmission_onlinetext_NNN ...">
  //   <div class="no-overflow">...HTML text...</div>
  let submissionTextHtml: string | null = null;
  const onlineTextRe = /class="[^"]*full_assignsubmission_onlinetext_\d+[^"]*"/i;
  const onlineTextStart = onlineTextRe.exec(html);
  if (onlineTextStart) {
    // Walk forward from the div open tag to find the first <div class="no-overflow">
    const outerStart = html.lastIndexOf("<div", onlineTextStart.index);
    const noOverflowIdx = html.indexOf(`class="no-overflow"`, outerStart);
    if (noOverflowIdx !== -1) {
      const contentStart = html.indexOf(">", noOverflowIdx) + 1;
      // Use depth counter to find matching </div>
      let depth = 1;
      let pos = contentStart;
      while (pos < html.length && depth > 0) {
        const nextOpen = html.indexOf("<div", pos);
        const nextClose = html.indexOf("</div>", pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            const inner = html.slice(contentStart, nextClose).trim();
            if (inner) submissionTextHtml = inner;
          }
          pos = nextClose + 6;
        }
      }
    }
  }

  // --- Submission file URLs ---
  // Student's own files: pluginfile.php links inside .fileuploadsubmission or .assignsubmission
  const submissionUrls: string[] = [];
  const seen = new Set<string>();
  const fileRe = /href="(https?:\/\/[^"]*pluginfile\.php\/[^"]*assignsubmission[^"]+)"/gi;
  let fileM: RegExpExecArray | null;
  while ((fileM = fileRe.exec(html)) !== null) {
    const url = fileM[1]!;
    if (!seen.has(url)) {
      seen.add(url);
      submissionUrls.push(url);
    }
  }

  // --- Teacher-attached introattachment file URLs ---
  // Teacher files: pluginfile.php links with mod_assign/introattachment path component
  // Example: pluginfile.php/4891149/mod_assign/introattachment/0/Lernbrief%201_OGPM.pdf?forcedownload=1
  const introattachmentUrls: string[] = [];
  const introRe = /href="(https?:\/\/[^"]*pluginfile\.php\/[^"]*\/mod_assign\/introattachment\/[^"]+)"/gi;
  let introM: RegExpExecArray | null;
  while ((introM = introRe.exec(html)) !== null) {
    const url = introM[1]!;
    if (!seen.has(url)) {
      seen.add(url);
      introattachmentUrls.push(url);
    }
  }

  // Return the result — even if grade/feedback are null, submission URLs may exist
  if (grade === null && feedbackHtml === null && submissionUrls.length === 0 && introattachmentUrls.length === 0 && submissionTextHtml === null) return null;
  return { grade, feedbackHtml, submissionUrls, introattachmentUrls, submissionTextHtml };
}
