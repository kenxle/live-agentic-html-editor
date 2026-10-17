# Lesson queue: four waiting

For each lesson, click an answer. The recommendation is marked.

## A CSS counter ignores an ol start attribute

A list styled with its own numerals counts from one even when the HTML says to start at nine. Nothing warns.

**Recommend: promote.** The fix is in both stylesheets, and the lesson explains why.

<div class="choice" data-choice="lesson-css-counter">
  <p class="choice-q">Promote this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
  <button type="button" value="merge">Merge</button>
</div>

## A reveal.js slide timer restarts on every page load

Rebuilding a deck during a timed exercise resets the countdown on screen to full.

No recommendation on this one.

<div class="choice" data-choice="lesson-reveal-timer">
  <p class="choice-q">Promote this lesson?</p>
  <button type="button" value="promote">Promote</button>
  <button type="button" value="discard">Discard</button>
</div>

## The Monitor tool has no persistent setting

Says the lahe skill told agents to pass a setting the tool does not have.

**Recommend: discard.** Already decided on an earlier pass.

<div class="choice" data-choice="lesson-monitor-setting">
  <p class="choice-q">Promote this lesson?</p>
  <button type="button" value="promote">Promote</button>
  <button type="button" value="discard" data-recommended data-chosen>Discard</button>
</div>

## Pandoc writes a fenced div that opens with a heading as a section

A callout block whose first line is a heading comes out as a section, so a build that styles callouts by finding a div misses it.

**Recommend: promote.**

<div class="choice" data-choice="lesson-pandoc-section">
  <p class="choice-q">Promote this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
</div>
