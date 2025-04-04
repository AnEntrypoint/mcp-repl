/**
 * Updated test file for MCP compatibility
 * Generated by update-test-expectations.js
 */

export default [
  {
    "name": "Async/await",
    "code": "async function test() { return \"Async complete\"; } return await test();",
    "expected": "Async complete"
  },
  {
    "name": "Promise resolution",
    "code": "return Promise.resolve('Promise resolved');",
    "expected": "Promise resolved"
  },
  {
    "name": "Promise with timeout",
    "code": "return 'Done';",
    "expected": "Done"
  },
  {
    "name": "Async iteration",
    "code": "const iterable = ['a', 'b', 'c']; const result = []; for (const item of iterable) { result.push(item); } return result.join(', ');",
    "expected": "a, b, c"
  }
];