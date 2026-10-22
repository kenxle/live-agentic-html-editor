# Broken groups

Every group on this page is wrong in one way, except the last two.

## No name

<div class="choice">
  <p class="choice-q">No name on this group.</p>
  <button type="button" value="yes">Yes</button>
  <button type="button" value="no">No</button>
</div>

## Bad name

<div class="choice" data-choice="Has Spaces And Caps">
  <p class="choice-q">A name off the grammar.</p>
  <button type="button" value="yes">Yes</button>
  <button type="button" value="no">No</button>
</div>

## Duplicate pair

<div class="choice" data-choice="twin">
  <p class="choice-q">First of two groups named twin.</p>
  <button type="button" value="yes">Yes</button>
  <button type="button" value="no">No</button>
</div>

<div class="choice" data-choice="twin">
  <p class="choice-q">Second of two groups named twin.</p>
  <button type="button" value="yes">Yes</button>
  <button type="button" value="no">No</button>
</div>

## One button

<div class="choice" data-choice="lonely">
  <p class="choice-q">Only one answer.</p>
  <button type="button" value="yes">Yes</button>
</div>

## Bad value

<div class="choice" data-choice="bad-value">
  <p class="choice-q">One value off the grammar.</p>
  <button type="button" value="yes please do it">Yes</button>
  <button type="button" value="no">No</button>
</div>

## Buttons wrapped in paragraphs

<div class="choice" data-choice="wrapped">
  <p class="choice-q">Each button sits inside a paragraph.</p>
  <p><button type="button" value="yes">Yes</button></p>
  <p><button type="button" value="no">No</button></p>
</div>

## Same value twice

<div class="choice" data-choice="same-value">
  <p class="choice-q">Two buttons share a value.</p>
  <button type="button" value="yes">Yes</button>
  <button type="button" value="yes">Also yes</button>
</div>

## Two chosen

<div class="choice" data-choice="two-chosen">
  <p class="choice-q">Two buttons carry data-chosen.</p>
  <button type="button" value="yes" data-chosen>Yes</button>
  <button type="button" value="no" data-chosen>No</button>
</div>

## Keys as an agent wrote them

<div class="choice" data-choice="Closest_21">
  <p class="choice-q">Uppercase and underscores are fine.</p>
  <button type="button" value="A_jev">A</button>
  <button type="button" value="B_jev">B</button>
</div>

## Valid

<div class="choice" data-choice="fine">
  <p class="choice-q">This one is fine.</p>
  <button type="button" value="yes" data-recommended>Yes</button>
  <button type="button" value="no">No</button>
</div>
