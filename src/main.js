import Vue from 'vue';
import VueCompositionApi from '@vue/composition-api';

Vue.use(VueCompositionApi);

import App from './App.vue';
import vuetify from './plugins/vuetify';
import router from './router';
import {clearProjectStorage, useLoadLastProjectStorage} from './hooks/project';
import {migrateLegacyPlayerAnimationsInLocalStorage} from './hooks/migrate-player-animations';
import {migrateLegacyPlayerBlocksInLocalStorage} from './hooks/migrate-player-blocks';
import {migrateLegacyBounceBlocksInLocalStorage} from './hooks/migrate-bounce-blocks';
import {migrateLegacyInertiaAccelerateBlocksInLocalStorage} from './hooks/migrate-inertia-accelerate-blocks';
import {migrateLegacyJoystickBlocksInLocalStorage} from './hooks/migrate-joystick-blocks';
import {migrateLegacyKeypadBlocksInLocalStorage} from './hooks/migrate-keypad-blocks';
import './registerServiceWorker';

// Combines an existing project's  separate legacy Player 0/Player 1
// animation storage into the single shared pool this app now uses - see
// that function's  comment for why this has to run before the app is
// created, same timing reasoning as the loadLastProject check just below.
migrateLegacyPlayerAnimationsInLocalStorage();

// Rewrites any old sprite_player0_*/sprite_player1_* blocks left over from
// before Player 0/1 shared one combined block type - see that function's
// own comment for the full reasoning, same "run before anything else reads
// the workspace" timing as the animation migration just above.
migrateLegacyPlayerBlocksInLocalStorage();

// Rewrites any old sprite_missile_bounce/sprite_ball_bounce blocks left
// over from before Bounce became one unified object_bounce block covering
// all 5 sprite names - see that function's  comment, same "run before
// anything else reads the workspace" timing as the migrations above.
migrateLegacyBounceBlocksInLocalStorage();

// Rewrites any old sprite_inertia_accelerate blocks missing their ACTION
// field, and any old sprite_inertia_stop_accelerate blocks, left over from
// before Accelerate/Stop accelerating became one combined block with an
// ACTION dropdown - see that function's comment, same "run before anything
// else reads the workspace" timing as the migrations above.
migrateLegacyInertiaAccelerateBlocksInLocalStorage();

// Rewrites any old input_joy0_*/input_joy1_* blocks left over from before
// Joystick 0/1 shared one combined block type per feature - see that
// function's comment, same "run before anything else reads the workspace"
// timing as the migrations above.
migrateLegacyJoystickBlocksInLocalStorage();

// Rewrites any old input_keypad0_*/input_keypad1_* blocks left over from
// before Keypad 0/1 shared one combined block type per feature - see that
// function's comment, same "run before anything else reads the workspace"
// timing as the migrations above.
migrateLegacyKeypadBlocksInLocalStorage();

// Whether to restore the last saved project on startup is a user preference
// (see the Options tab) rather than always-on - when disabled, every launch
// starts from the empty/default project instead. Done before the app is
// created so nothing has read the old project yet.
if (!useLoadLastProjectStorage().value) {
  clearProjectStorage();
}

Vue.config.productionTip = false;
// Add unimported components to ignore list to prevent warnings.
Vue.config.ignoredElements = ['field', 'block', 'category', 'xml', 'mutation', 'value', 'sep'];

new Vue({
  vuetify,
  router,
  render: (h) => h(App),
}).$mount('#app');
