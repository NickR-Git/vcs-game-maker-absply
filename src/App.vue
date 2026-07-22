<template>
  <v-app id="inspire">
    <v-system-bar app>
      <v-card-text>{{ name }} {{ version }}</v-card-text>

      <v-spacer></v-spacer>

      <v-icon>mdi-square</v-icon>

      <v-icon>mdi-circle</v-icon>

      <v-icon>mdi-triangle</v-icon>
    </v-system-bar>

    <v-app-bar
      app
      clipped-right
      flat
      height="72"
    >
      <v-toolbar
        flat
        class="navigation-list"
      >
        <v-btn to="/" link class="actions-item" title="Actions" elevation="0">
          <v-icon>mdi-chart-scatter-plot</v-icon>
        </v-btn>

        <v-btn to="/player0" link class="player0-item" title="Player 0" elevation="0">
          <v-icon>mdi-human-handsup</v-icon>
        </v-btn>

        <v-btn to="/player1" link class="player1-item" title="Player 1" elevation="0">
          <v-icon>mdi-human-handsup</v-icon>
        </v-btn>

        <v-btn to="/background" link class="background-item" title="Background" elevation="0">
          <v-icon>mdi-map</v-icon>
        </v-btn>

        <v-btn to="/sound" link class="sound-item" title="Sound" elevation="0">
          <v-icon>mdi-speaker</v-icon>
        </v-btn>

        <v-btn to="/configuration" link class="configuration-item" title="Options" elevation="0">
          <v-icon>mdi-cog</v-icon>
        </v-btn>

        <v-btn to="/generated" link class="generated-item" title="Generated" elevation="0">
          <v-icon>mdi-card-text</v-icon>
        </v-btn>

        <v-btn to="/project" link class="project-item" title="Project" elevation="0">
          <v-icon>mdi-pencil-ruler</v-icon>
        </v-btn>
      </v-toolbar>
    </v-app-bar>

    <v-navigation-drawer
      v-model="drawer"
      app
      width="200"
    >
      <v-sheet
        color="grey lighten-5"
        height="128"
        width="100%"
      ></v-sheet>

      <v-list
        shaped
        class="navigation-list"
      >
        <v-list-item
          to="/"
          link
          class="actions-item"
        >
          <v-list-item-icon>
            <v-icon>mdi-chart-scatter-plot</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Actions</v-list-item-title>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          to="/player0"
          link
          class="player0-item"
        >
          <v-list-item-icon>
            <v-icon>mdi-human-handsup</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Player 0</v-list-item-title>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          to="/player1"
          link
          class="player1-item"
        >
          <v-list-item-icon>
            <v-icon>mdi-human-handsup</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Player 1</v-list-item-title>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          to="/background"
          link
          class="background-item"
        >
          <v-list-item-icon>
            <v-icon>mdi-map</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Background</v-list-item-title>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          to="/sound"
          link
          class="sound-item"
        >
          <v-list-item-icon>
            <v-icon>mdi-speaker</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Sound</v-list-item-title>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          to="/configuration"
          link
          class="configuration-item"
        >
          <v-list-item-icon>
            <v-icon>mdi-cog</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Options</v-list-item-title>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          to="/generated"
          link
          class="generated-item"
        >
          <v-list-item-icon>
            <v-icon>mdi-card-text</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Generated</v-list-item-title>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          to="/project"
          link
          class="project-item"
        >
          <v-list-item-icon>
            <v-icon>mdi-pencil-ruler</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Project</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>

    </v-navigation-drawer>

    <v-navigation-drawer
      app
      clipped
      right
      permanent
      class="emulator-drawer"
      :width="emulatorWidth"
    >
      <div
        class="emulator-resize-handle"
        title="Drag to resize the emulator"
        @mousedown.prevent="startResize"
      ></div>
      <div id="javatari-target-container" :style="emulatorScaleStyle"></div>
      <v-btn block color="primary" @click="handleRomDownload">
        Get generated ROM
      </v-btn>
    </v-navigation-drawer>

    <v-main class="app-main">
      <router-view/>
    </v-main>

    <v-footer class="error-message">
      <pre v-text="errorStorage"></pre>
    </v-footer>
  </v-app>
</template>

<script>
import {useErrorStorage} from './hooks/project';
import {name, version} from '../package.json';

// Javatari renders at a fixed size and never reflows to fit its container, so
// the emulator is scaled with a CSS transform instead. These are its natural
// dimensions at scale 1, including the margin reserved for the console panel.
const EMULATOR_BASE_WIDTH = 256;
const EMULATOR_BASE_HEIGHT = 276;
const EMULATOR_MIN_WIDTH = 200;
const EMULATOR_MAX_WIDTH = 900;
// Keep enough room for the editor when dragging on smaller screens.
const EDITOR_MIN_WIDTH = 320;
const EMULATOR_WIDTH_KEY = 'vcs-game-maker.emulatorWidth';

const readStoredWidth = () => {
  const stored = parseInt(localStorage.getItem(EMULATOR_WIDTH_KEY), 10);
  return Number.isFinite(stored) ? stored : EMULATOR_BASE_WIDTH;
};

export default {
  data: () => ({
    drawer: null,
    emulatorWidth: readStoredWidth(),
  }),
  setup() {
    const errorStorage = useErrorStorage();
    console.info('Text', version);
    return {errorStorage, name, version};
  },
  mounted() {
    // Ugly hack in order to move the Javatari screen to a Vue component.
    const javatariScreen = document.getElementById('javatari-screen');
    document.getElementById('javatari-target-container').appendChild(javatariScreen);
    javatariScreen.style = '';
  },
  beforeDestroy() {
    this.stopResize();
  },
  computed: {
    emulatorScaleStyle() {
      const scale = this.emulatorWidth / EMULATOR_BASE_WIDTH;
      return {
        '--emulator-scale': scale,
        'height': `${Math.round(EMULATOR_BASE_HEIGHT * scale)}px`,
      };
    },
  },
  methods: {
    startResize() {
      window.addEventListener('mousemove', this.doResize);
      window.addEventListener('mouseup', this.stopResize);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
    },
    doResize(event) {
      const maxWidth = Math.min(EMULATOR_MAX_WIDTH, window.innerWidth - EDITOR_MIN_WIDTH);
      const width = window.innerWidth - event.clientX;
      this.emulatorWidth = Math.round(
          Math.min(maxWidth, Math.max(EMULATOR_MIN_WIDTH, width)));
    },
    stopResize() {
      window.removeEventListener('mousemove', this.doResize);
      window.removeEventListener('mouseup', this.stopResize);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      localStorage.setItem(EMULATOR_WIDTH_KEY, String(this.emulatorWidth));
      // Nudge layout-sensitive widgets (the Blockly canvas sizes its SVG from
      // its container, and only reflows on a window resize). This has to wait
      // for the drawer's new width to be applied to the DOM, otherwise they
      // measure the previous layout.
      this.$nextTick(() => window.dispatchEvent(new Event('resize')));
    },
    handleRomDownload() {
      const blob = new Blob([Javatari.compiledResult.output], {type: 'application/octet-stream'});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'compiled-rom.bin';
      link.click();
    },
  },
};
</script>
<!-- Unscoped: #javatari-screen is injected by Javatari at runtime, so it never
     carries this component's scope attribute. -->
<style>
#javatari-target-container {
  overflow: hidden;
}

#javatari-target-container > #javatari-screen {
  transform: scale(var(--emulator-scale, 1));
  transform-origin: top left;
}
</style>
<style scoped>
/* Vuetify animates the drawer's width over 200ms, but the emulator's scale is
   applied instantly, so the two visibly drift apart while dragging. This drawer
   is permanent and never slides open, so the width transition serves no
   purpose; dropping it keeps the column and the emulator in lockstep. */
.emulator-drawer {
  transition-property: transform, visibility;
}

/* Vuetify offsets the main content with an animated padding matching the
   drawer width, which makes the Blockly canvas ease into its new size while
   the column and emulator resize instantly. It also means the canvas is
   measured mid-animation when it reflows. Both drawers here are permanent, so
   nothing needs to animate. */
.app-main {
  transition: none;
}

.emulator-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  z-index: 2;
}

.emulator-resize-handle:hover {
  background-color: rgba(0, 0, 0, 0.15);
}

.v-list-item__icon {
  margin-right: 12px !important;
}

.navigation-list > .v-list-item:not(.v-list-item--active) {
  border-left: 8px solid;
}

.navigation-list > .v-list-item:not(.v-list-item--active) {
  opacity: 0.65;
}

.actions-item,
.actions-item > .v-list-item__icon > .theme--light.v-icon,
.actions-item > .v-list-item__content {
  color: rgb(76, 175, 80) !important;
  border-left-color: rgb(76, 175, 80) !important;
}

.player0-item,
.player0-item > .v-list-item__icon > .theme--light.v-icon,
.player0-item > .v-list-item__content {
  color: rgb(244, 67, 54) !important;
  border-left-color: rgb(244, 67, 54) !important;
}

.player1-item,
.player1-item > .v-list-item__icon > .theme--light.v-icon,
.player1-item > .v-list-item__content {
  color: rgb(33, 150, 243) !important;
  border-left-color: rgb(33, 150, 243) !important;
}

.background-item,
.background-item > .v-list-item__icon > .theme--light.v-icon,
.background-item > .v-list-item__content {
  color: rgb(255, 152, 0) !important;
  border-left-color: rgb(255, 152, 0) !important;
}

.sound-item,
.sound-item > .v-list-item__icon > .theme--light.v-icon,
.sound-item > .v-list-item__content {
  color: rgb(156, 39, 176) !important;
  border-left-color: rgb(156, 39, 176) !important;
}

.configuration-item,
.configuration-item > .v-list-item__icon > .theme--light.v-icon,
.configuration-item > .v-list-item__content {
  color: rgb(96, 96, 244) !important;
  border-left-color: rgb(96, 96, 244) !important;
}

.generated-item,
.generated-item > .v-list-item__icon > .theme--light.v-icon,
.generated-item > .v-list-item__content {
  color: rgb(39, 176, 136) !important;
  border-left-color: rgb(39, 176, 136) !important;
}

.project-item,
.project-item > .v-list-item__icon > .theme--light.v-icon,
.project-item > .v-list-item__content {
  color: rgb(39, 136, 176) !important;
  border-left-color: rgb(39, 136, 176) !important;
}

.error-message {
  z-index: 10;
  max-height: 7em;
  overflow-y: scroll;
}

.theme--light.v-footer.error-message {
  color: rgb(244, 67, 54);
}
</style>
