import { spawn } from 'node:child_process';

/** Bounded subprocess lifetime/output; no user-controlled command or shell. */
export function runCommand(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    const stop = (message: string) => {
      failure = new Error(message);
      child.kill('SIGKILL');
    };
    const timer = setTimeout(
      () => stop('MEDIA_PROCESS_TIMEOUT: Processing exceeded 120 seconds.'),
      120000,
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1048576)
        stop('MEDIA_OUTPUT_LIMIT: Probe output is too large.');
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-65536);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(stderr.trim() || `Media tool exited with code ${code}.`),
        );
    });
  });
}
