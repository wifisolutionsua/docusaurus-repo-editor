export function previewBuildState(line) {
  const message = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
  if (/\bcompiled (?:successfully|with \d+ warnings?)\b/i.test(message)) {
    return {phase: 'ready'};
  }
  if (/\b(?:failed to compile|compiled with .*errors?|ERROR in|ERROR Module build failed)\b/i.test(message)) {
    return {phase: 'error', message};
  }
  if (/\b(?:compiling client|recompiling|building client)\b/i.test(message)) {
    return {phase: 'compiling'};
  }
  return null;
}
