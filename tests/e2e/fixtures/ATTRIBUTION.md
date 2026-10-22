# Test fixtures

All fixtures in the repository are generated for the tests. `scene-synthetic.png` comes from
tests/synthetic/scenes.ts and is used by the a11y, background-removal, mobile, Pages and prod tests.

The object-count tests (`count.spec.ts`) need a real street photo with about 10 people, a car and
traffic lights. It is not committed, because no photo with a verified licence and model releases has
been found. Put one at `tests/e2e/fixtures/street.jpg` to run them locally; without it they skip.
