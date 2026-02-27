const YOUTUBE_HOST_SUFFIX = '.youtube.com';
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtu.be']);
const EMBEDDED_VIDEO_PATH_PREFIXES = new Set(['shorts', 'live', 'embed']);

export function isYouTubeHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h !== '' && (YOUTUBE_HOSTS.has(h) || h.endsWith(YOUTUBE_HOST_SUFFIX));
}

function isYouTubeVideoPath(url: URL): boolean {
  if (!isYouTubeHostname(url.hostname)) {
    return false;
  }

  const pathname = url.pathname.replace(/\/+$/, '');

  if (url.hostname === 'youtu.be') {
    return pathname.length > 1;
  }

  if (pathname === '/watch') {
    const v = url.searchParams.get('v');
    return v !== null && v.trim().length > 0;
  }

  const segments = pathname.split('/').filter(Boolean);
  const prefix = segments[0];
  return segments.length >= 2 && !!prefix && EMBEDDED_VIDEO_PATH_PREFIXES.has(prefix.toLowerCase());
}

export function getYouTubeUrlForPrompt(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return isYouTubeVideoPath(url) ? url.toString() : null;
  } catch {
    return null;
  }
}
