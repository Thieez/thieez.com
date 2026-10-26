<script lang="ts">
  import type { ApiAsset, LatestBuild } from '$lib/api';

  export let loading: boolean;
  export let release: LatestBuild | null;
  export let error: string;
  export let pendingWindowsDownloads: Set<string>;
  export let windowsDownloadErrors: Record<string, string>;
  export let getAssetDownloadUrl: (asset: ApiAsset) => string | undefined;
  export let downloadWindowsExecutable: (asset: ApiAsset) => void;

  const isAndroidInstall = (asset: ApiAsset) => /\.apk$/i.test(asset.name);
  const isWindowsInstall = (asset: ApiAsset) => /\.(?:exe|zip)$/i.test(asset.name);
</script>

<section class="project-release-section" aria-labelledby="project-releases-heading">
  <h2 id="project-releases-heading">Releases</h2>
  {#if loading}
    <div class="state-panel" aria-live="polite">
      <span class="loader" aria-hidden="true"></span>
      <span>Loading releases…</span>
    </div>
  {:else if error}
    <div class="state-panel error-panel" role="alert">
      <strong>Couldn’t load releases.</strong>
      <span>{error}</span>
    </div>
  {:else if release}
    {@const assets = release.assets.filter(
      (asset) => asset.download_url || asset.browser_download_url
    )}
    {@const androidAssets = assets.filter(isAndroidInstall)}
    {@const windowsAssets = assets.filter(isWindowsInstall)}
    <div class="release-card">
      <div class="release-topline">
        <span class="release-label">LATEST RELEASE</span>
        <span class="release-rule"></span>
        <span class="release-date">{release.tag_name || 'Latest'}</span>
      </div>
      {#if androidAssets.length || windowsAssets.length}
        <div class="project-release-platforms">
          {#if androidAssets.length}
            <section class="release-platform" aria-label="Android installation files">
              <h3>Android</h3>
              <div class="platform-downloads">
                {#each androidAssets as asset (asset.name)}
                  <a
                    class="download-button"
                    href={getAssetDownloadUrl(asset)}
                    download={asset.name}
                    aria-label={`Download for Android (${asset.name})`}
                  >
                    Download <span aria-hidden="true">↓</span>
                  </a>
                {/each}
              </div>
            </section>
          {/if}
          {#if windowsAssets.length}
            <section class="release-platform" aria-label="Windows installation files">
              <h3>Windows</h3>
              <div class="platform-downloads">
                {#each windowsAssets as asset (asset.name)}
                  {#if /\.zip$/i.test(asset.name)}
                    <button
                      class="download-button"
                      type="button"
                      disabled={pendingWindowsDownloads.has(asset.name)}
                      aria-label={`Download for Windows (${asset.name})`}
                      onclick={() => downloadWindowsExecutable(asset)}
                    >
                      {pendingWindowsDownloads.has(asset.name) ? 'Preparing…' : 'Download'}
                      <span aria-hidden="true">↓</span>
                    </button>
                    {#if windowsDownloadErrors[asset.name]}
                      <p class="download-error" role="alert">{windowsDownloadErrors[asset.name]}</p>
                    {/if}
                  {:else}
                    <a
                      class="download-button"
                      href={getAssetDownloadUrl(asset)}
                      download={asset.name}
                      aria-label={`Download for Windows (${asset.name})`}
                    >
                      Download <span aria-hidden="true">↓</span>
                    </a>
                  {/if}
                {/each}
              </div>
            </section>
          {/if}
        </div>
      {:else}
        <div class="state-panel">
          <strong>No Android or Windows downloads are available yet.</strong>
        </div>
      {/if}
    </div>
  {:else}
    <div class="state-panel">
      <strong>No release is available yet.</strong>
    </div>
  {/if}
</section>
