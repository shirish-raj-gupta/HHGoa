import { describe, expect, it } from 'vitest';
import { HttpRequestError } from 'viem';
import { unreachable } from '../src/app';

describe('unreachable', () => {
  const fetchFailed = () => new TypeError('fetch failed');

  it('blames Base only when viem made the call', () => {
    const rpc = new HttpRequestError({ url: 'https://sepolia.base.org', cause: fetchFailed() });
    expect(unreachable(new Error('postRoot failed', { cause: rpc }))).toBe('chain');
  });

  it('calls an SDK connection error an outside service', () => {
    // The shape of Dodo's (and OpenAI's) APIConnectionError: "Connection error." over the fetch failure.
    expect(unreachable(new Error('Connection error.', { cause: fetchFailed() }))).toBe('upstream');
    expect(unreachable(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('upstream');
  });

  it('leaves other errors alone', () => {
    expect(unreachable(new Error('duplicate key value'))).toBeNull();
  });
});
