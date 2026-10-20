import { expect, test } from 'bun:test';
import * as penFormat from '../src/index.ts';

test('package entry point loads', () => {
  expect(penFormat).toBeDefined();
});
