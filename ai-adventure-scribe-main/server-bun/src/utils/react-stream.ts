import { renderToReadableStream } from 'react-dom/server.browser';

import { logger } from '../lib/logger.js';

import type { ReactElement } from 'react';


interface StreamOptions {
  status?: number;
  headers?: Record<string, string>;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
}

/**
 * Stream a React element to a Web ReadableStream response (Bun/Web Streams API)
 *
 * This is the Bun/Elysia equivalent of Express's streamReactResponse using renderToPipeableStream.
 * Uses renderToReadableStream which returns a Web ReadableStream compatible with modern browsers.
 *
 * @param element - React element to render
 * @param options - Streaming options (status, headers, error handler, abort signal)
 * @returns Response object with the streamed HTML
 */
export async function streamReactResponse(
  element: ReactElement,
  { status = 200, headers = {}, onError, signal }: StreamOptions = {}
): Promise<Response> {
  try {
    const stream = await renderToReadableStream(element, {
      signal,
      onError: (error: unknown) => {
        handleError(error, onError);
      },
    });

    // Prepend DOCTYPE to the stream
    const doctype = new TextEncoder().encode('<!DOCTYPE html>');
    const doctypeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(doctype);
        controller.close();
      },
    });

    // Concatenate DOCTYPE with React stream
    const combinedStream = concatenateStreams(doctypeStream, stream);

    return new Response(combinedStream, {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...headers,
      },
    });
  } catch (error) {
    handleError(error, onError);

    // Return error page
    const errorHtml = '<!DOCTYPE html><html><body>Something went wrong.</body></html>';
    return new Response(errorHtml, {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  }
}

/**
 * Concatenate two ReadableStreams into one
 */
function concatenateStreams(
  stream1: ReadableStream<Uint8Array>,
  stream2: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const reader1 = stream1.getReader();
  const reader2 = stream2.getReader();
  let useFirstStream = true;

  return new ReadableStream({
    async pull(controller) {
      if (useFirstStream) {
        const { done, value } = await reader1.read();
        if (done) {
          useFirstStream = false;
          // Continue to second stream
          const { done: done2, value: value2 } = await reader2.read();
          if (done2) {
            controller.close();
          } else {
            controller.enqueue(value2);
          }
        } else {
          controller.enqueue(value);
        }
      } else {
        const { done, value } = await reader2.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      }
    },
    cancel() {
      reader1.cancel();
      reader2.cancel();
    },
  });
}

function handleError(error: unknown, onError?: (error: unknown) => void) {
  logger.error({ msg: 'SSR render error', error });
  onError?.(error);
}
