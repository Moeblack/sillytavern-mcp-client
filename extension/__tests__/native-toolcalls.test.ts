import { describe, it, expect } from 'vitest';
import { extractToolCallsFromData } from '../src/native-toolcalls.js';

// These fixtures are intentionally minimal and mirror SillyTavern's parsing logic.

describe('extractToolCallsFromData', () => {
  it('should extract OpenAI-style tool_calls from choices[0].message.tool_calls', () => {
    const data = {
      choices: [
        {
          index: 0,
          message: {
            tool_calls: [
              { id: 'call_1', function: { name: 'mcp__s__t', arguments: { a: 1 } } },
            ],
          },
        },
      ],
    };

    expect(extractToolCallsFromData(data)).toEqual([
      { id: 'call_1', function: { name: 'mcp__s__t', arguments: { a: 1 } } },
    ]);
  });

  it('should convert Claude tool_use blocks to OpenAI tool_calls', () => {
    const data = {
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'toolu_1', name: 'mcp__srv__tool', input: { q: 'x' } },
      ],
    };

    expect(extractToolCallsFromData(data)).toEqual([
      { id: 'toolu_1', function: { name: 'mcp__srv__tool', arguments: { q: 'x' } } },
    ]);
  });

  it('should extract Cohere tool_calls from message.tool_calls', () => {
    const data = {
      message: {
        tool_calls: { id: 'c1', function: { name: 'mcp__a__b', arguments: { x: true } } },
      },
    };

    expect(extractToolCallsFromData(data)).toEqual([
      { id: 'c1', function: { name: 'mcp__a__b', arguments: { x: true } } },
    ]);
  });

  it('should convert Google AI Studio functionCall parts', () => {
    const data = {
      responseContent: {
        parts: [
          { functionCall: { name: 'mcp__g__t', args: { n: 1 } }, thoughtSignature: 'sig' },
        ],
      },
    };

    const calls = extractToolCallsFromData(data);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('mcp__g__t');
    expect(calls[0].function.arguments).toEqual({ n: 1 });
    expect(calls[0].signature).toBe('sig');
    expect(typeof calls[0].id).toBe('string');
  });
});
