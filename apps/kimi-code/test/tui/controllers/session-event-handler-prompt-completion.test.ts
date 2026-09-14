import type { Event, PromptCompletedEvent } from '@moonshot-ai/kimi-code-sdk';
import { describe, expect, it, vi } from 'vitest';

import { SessionEventHandler } from '#/tui/controllers/session-event-handler';

function makeHarness(streamingPhase: 'idle' | 'waiting' = 'waiting') {
  const streamingUI = {
    setTurnId: vi.fn(),
    setStep: vi.fn(),
    flushNow: vi.fn(),
    resetToolUi: vi.fn(),
    finalizeTurn: vi.fn(),
    getTurnContext: vi.fn(() => ({ turnId: undefined, step: 0 })),
  };
  const host = {
    state: {
      appState: {
        availableModels: {},
        workDir: '/tmp/work',
        streamingPhase,
        stepRetry: null,
      },
      ui: { requestRender: vi.fn() },
      transcriptContainer: { addChild: vi.fn() },
      todoPanel: { getTodos: vi.fn(() => []) },
    },
    session: undefined,
    streamingUI,
    appendTranscriptEntry: vi.fn(),
    patchLivePane: vi.fn(),
    setAppState: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(host.state.appState, patch);
    }),
    recordSessionActivity: vi.fn(),
    showStatus: vi.fn(),
    showError: vi.fn(),
    btwPanelController: { routeEvent: vi.fn(() => false) },
    surveyController: { notifyToolCallStarted: vi.fn() },
    updateActivityPane: vi.fn(),
  };
  const handler = new SessionEventHandler(host as never);
  return { handler, host, streamingUI };
}

function promptCompleted(promptId: string, reason: PromptCompletedEvent['reason']): Event {
  return {
    sessionId: 's1',
    agentId: 'main',
    type: 'prompt.completed',
    promptId,
    finishedAt: '2026-01-01T00:00:00.000Z',
    reason,
  } as Event;
}

function turnStarted(promptId?: string): Event {
  return {
    sessionId: 's1',
    agentId: 'main',
    type: 'turn.started',
    turnId: 7,
    origin: { kind: 'user' },
    promptId,
  } as Event;
}

describe('SessionEventHandler — blocked prompt completion settlement', () => {
  it('settles the expected blocked submission only once', () => {
    const { handler, streamingUI } = makeHarness('waiting');
    const sendQueued = vi.fn();
    handler.expectPromptSubmission('p1');

    handler.handleEvent(promptCompleted('p1', 'blocked'), sendQueued);
    handler.handleEvent(promptCompleted('p1', 'blocked'), sendQueued);

    expect(streamingUI.finalizeTurn).toHaveBeenCalledTimes(1);
    expect(streamingUI.finalizeTurn).toHaveBeenCalledWith(sendQueued);
  });

  it('ignores completions for other prompts or without an expectation', () => {
    const { handler, streamingUI } = makeHarness('waiting');

    handler.handleEvent(promptCompleted('p-other', 'blocked'), vi.fn());
    expect(streamingUI.finalizeTurn).not.toHaveBeenCalled();

    handler.expectPromptSubmission('p1');
    handler.handleEvent(promptCompleted('p-other', 'blocked'), vi.fn());
    handler.clearExpectedPromptSubmission('p1');
    handler.handleEvent(promptCompleted('p1', 'blocked'), vi.fn());
    expect(streamingUI.finalizeTurn).not.toHaveBeenCalled();
  });

  it('ignores completions of prompts that settled through a turn', () => {
    const { handler, streamingUI } = makeHarness('waiting');

    handler.expectPromptSubmission('p1');
    handler.handleEvent(turnStarted('p1'), vi.fn());
    handler.handleEvent(promptCompleted('p1', 'blocked'), vi.fn());

    expect(streamingUI.finalizeTurn).not.toHaveBeenCalled();
  });

  it.each(['p-other', undefined])('does not end an unrelated active turn (promptId: %s)', (promptId) => {
    const { handler, streamingUI } = makeHarness('waiting');

    handler.expectPromptSubmission('p1');
    handler.handleEvent(turnStarted(promptId), vi.fn());
    handler.handleEvent(promptCompleted('p1', 'blocked'), vi.fn());

    expect(streamingUI.finalizeTurn).not.toHaveBeenCalled();
  });

  it('does not let an old request error clear a newer expectation', () => {
    const { handler, streamingUI } = makeHarness('waiting');

    handler.expectPromptSubmission('p1');
    handler.expectPromptSubmission('p2');

    expect(handler.clearExpectedPromptSubmission('p1')).toBe(false);
    handler.handleEvent(promptCompleted('p2', 'blocked'), vi.fn());
    expect(streamingUI.finalizeTurn).toHaveBeenCalledTimes(1);
  });

  it('ignores a completion that arrives after runtime reset', () => {
    const { handler, streamingUI } = makeHarness('waiting');

    handler.expectPromptSubmission('p1');
    handler.resetRuntimeState();
    handler.handleEvent(promptCompleted('p1', 'blocked'), vi.fn());

    expect(streamingUI.finalizeTurn).not.toHaveBeenCalled();
  });

  it('does not finalize again when the UI is already idle', () => {
    const { handler, streamingUI } = makeHarness('idle');
    handler.expectPromptSubmission('p1');

    handler.handleEvent(promptCompleted('p1', 'blocked'), vi.fn());

    expect(streamingUI.finalizeTurn).not.toHaveBeenCalled();
  });

  it('ignores non-blocked completion reasons', () => {
    const { handler, streamingUI } = makeHarness('waiting');
    handler.expectPromptSubmission('p1');

    handler.handleEvent(promptCompleted('p1', 'completed'), vi.fn());
    handler.handleEvent(promptCompleted('p1', 'failed'), vi.fn());

    expect(streamingUI.finalizeTurn).not.toHaveBeenCalled();
  });
});
