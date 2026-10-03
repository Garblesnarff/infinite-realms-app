import './setup-base';

if (typeof window !== 'undefined') {
  await import('./setup-dom');
}
