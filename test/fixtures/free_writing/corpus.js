// Markup corpora for the free-writing kernel (Task 1.1).
//
// Two lists of strings, loaded by the unit tests with require() and by the
// browser specs by injecting this file into a fixture page, so the string
// reader and the DOM walk read the same bytes.
//
//   MALFORMED   markup a browser repairs on parse. The string reader must
//               agree with what the browser builds from the same string.
//   ENGINE      markup a browser's own editing engine produces inside a
//               block. cleanBlock must be a fixed point on its own output
//               for every sample.
(function (root) {
  "use strict";

  var MALFORMED = [
    // A p closed by a div: the div starts its own block.
    { name: "p closed by a div", html: "<p>First words here<div>Then a div block</div>" },
    // An li with no end tag: the next li closes it.
    { name: "unclosed li", html: "<ul><li>One item<li>Two item</ul><p>After the list</p>" },
    // A script body that holds a p. It is script text, never a block.
    { name: "script holding a p", html: "<p>Before the script</p><script>var s = \"<p>not a block</p>\";</script><p>After the script</p>" },
    // Template contents are inert.
    { name: "template contents", html: "<p>Outside the template</p><template><p>Inside the template</p></template>" },
    // Comments carry no text.
    { name: "comments", html: "<p>Kept words<!-- <p>hidden</p> --></p><!-- a comment --><p>More kept words</p>" }
  ];

  var ENGINE = [
    { name: "b and i", tag: "p", html: "Some <b>bold</b> and <i>italic</i> words" },
    { name: "nbsp", tag: "p", html: "Two&nbsp;words and a trailing space&nbsp;" },
    { name: "trailing br", tag: "p", html: "Ends with a break<br>" },
    { name: "nested strong and em", tag: "p", html: "A <strong>bold <em>and italic</em></strong> run" },
    { name: "entities", tag: "p", html: "Fish &amp; chips &lt;3 &gt; &quot;quoted&quot; &#39;single&#39; &#x2014; dash" },
    { name: "uppercase tags", tag: "h2", html: "An <STRONG>Uppercase</STRONG> <EM>heading</EM>" },
    { name: "list items", tag: "ul", html: "<li>First <b>item</b></li><LI>Second item<br></LI>" },
    { name: "numbered list", tag: "ol", html: "<li>One</li><li>Two &amp; three</li>" },
    { name: "line break mid", tag: "p", html: "Line one<br>Line two" }
  ];

  var api = { MALFORMED: MALFORMED, ENGINE: ENGINE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LAHE_FREE_WRITING_CORPUS = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
