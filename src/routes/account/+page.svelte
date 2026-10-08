<script lang="ts">
  import HomePage from '../+page.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<HomePage {data} />
