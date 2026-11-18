/**
 * WebXR Immersive AR capability detection and session negotiation.
 *
 * Strictly distinguishes true hardware-tracked WebXR (ARCore / Hit-Test / Anchors)
 * from ordinary webcam overlays so the UI never claims world tracking when unavailable.
 */

export async function detectWebXRCapabilities() {
  const isSecure = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isAndroid = /Android/i.test(ua);

  if (typeof navigator === 'undefined' || !navigator.xr) {
    return {
      xrApiAvailable: false,
      immersiveARSupported: false,
      isSecureContext: isSecure,
      isAndroid,
      reason: isSecure
        ? 'This browser does not expose the WebXR Device API (`navigator.xr`). True AR floor tracking requires Chrome/Edge on an ARCore-supported Android device.'
        : 'WebXR requires a secure HTTPS (or localhost) context.',
    };
  }

  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    return {
      xrApiAvailable: true,
      immersiveARSupported: Boolean(supported),
      isSecureContext: isSecure,
      isAndroid,
      reason: supported
        ? ''
        : 'WebXR `immersive-ar` is not supported on this hardware/browser. True floor detection & persistent world anchors require an ARCore-compatible Android device.',
    };
  } catch (err) {
    return {
      xrApiAvailable: true,
      immersiveARSupported: false,
      isSecureContext: isSecure,
      isAndroid,
      reason: err?.message || 'Failed to query WebXR `immersive-ar` session support.',
    };
  }
}

export async function requestFurnForgeXRSession(domOverlayRoot = null) {
  if (typeof navigator === 'undefined' || !navigator.xr) {
    throw new Error('WebXR is not available in this browser.');
  }

  const optionalFeatures = [
    'anchors',
    'plane-detection',
    'light-estimation',
    'depth-sensing',
  ];
  if (domOverlayRoot) {
    optionalFeatures.push('dom-overlay');
  }

  const sessionInit = {
    requiredFeatures: ['local-floor', 'hit-test'],
    optionalFeatures,
    ...(domOverlayRoot ? { domOverlay: { root: domOverlayRoot } } : {}),
    depthSensing: {
      usagePreference: ['cpu-optimized', 'gpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    },
  };

  try {
    return await navigator.xr.requestSession('immersive-ar', sessionInit);
  } catch (primaryErr) {
    // Some WebXR implementations reject depthSensing config or lack local-floor
    try {
      return await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['local-floor', ...optionalFeatures],
        ...(domOverlayRoot ? { domOverlay: { root: domOverlayRoot } } : {}),
      });
    } catch {
      throw primaryErr;
    }
  }
}
