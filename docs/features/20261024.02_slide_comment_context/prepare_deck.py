from pathlib import Path
import sys

root = Path(__file__).resolve().parents[3]
fixture = (root / 'test/fixtures/reveal-deck.html').read_text()
start = fixture.index('  <div class="reveal">')
end = fixture.index("  <!-- The page's own moving parts.", start)
slides = fixture[start:end]
css = '\n'.join((root / name).read_text() for name in [
    'vendor/reveal.js/dist/reset.css',
    'vendor/reveal.js/dist/reveal.css',
    'vendor/reveal.js/dist/theme/serif.css',
])
script = (root / 'vendor/reveal.js/dist/reveal.js').read_text().replace('</script', '<\\/script')
html = '<!doctype html><html><head><meta charset="utf-8"><title>Slide context proof</title><style>' + css + '</style></head><body>' + slides
html += '<script>' + script + '</script><script>Reveal.initialize({hash:true,slideNumber:"c/t",transition:"none"}).then(function(){window.__deckReady=true;});</script></body></html>'
output = Path(sys.argv[1])
output.mkdir(exist_ok=True)
(output / 'deck.html').write_text(html)
print(output / 'deck.html')
