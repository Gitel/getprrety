// Registry of every translation file. Each namespace (ns) is one JSON file per language and is
// owned by exactly one task, so parallel work never edits the same file.
// To add a namespace: create en/<ns>.json and he/<ns>.json, import them here and list it below.
import enCommon from './en/common.json';
import enMenu from './en/menu.json';
import enErrors from './en/errors.json';
import enAuth from './en/auth.json';
import enOnboarding from './en/onboarding.json';
import enQuiz from './en/quiz.json';
import enHome from './en/home.json';
import enContent from './en/content.json';
import enProfile from './en/profile.json';
import enScore from './en/score.json';
import enMessages from './en/messages.json';
import enSettings from './en/settings.json';
import enCamera from './en/camera.json';
import enNotifications from './en/notifications.json';

import heCommon from './he/common.json';
import heMenu from './he/menu.json';
import heErrors from './he/errors.json';
import heAuth from './he/auth.json';
import heOnboarding from './he/onboarding.json';
import heQuiz from './he/quiz.json';
import heHome from './he/home.json';
import heContent from './he/content.json';
import heEras from './he/eras.json';
import heProfile from './he/profile.json';
import heScore from './he/score.json';
import heMessages from './he/messages.json';
import heSettings from './he/settings.json';
import heCamera from './he/camera.json';
import heNotifications from './he/notifications.json';

// Every namespace i18next should know about. `eras` is Hebrew-only: the English era text stays
// in the ERAS constant (src/constants.js), so it has no en file.
export const NAMESPACES = [
  'common', 'menu', 'errors', 'auth', 'onboarding', 'quiz', 'home', 'content',
  'eras', 'profile', 'score', 'messages', 'settings', 'camera', 'notifications',
];

// Shape i18next expects: { language: { namespace: { key: value } } }
export const resources = {
  en: {
    common: enCommon,
    menu: enMenu,
    errors: enErrors,
    auth: enAuth,
    onboarding: enOnboarding,
    quiz: enQuiz,
    home: enHome,
    content: enContent,
    profile: enProfile,
    score: enScore,
    messages: enMessages,
    settings: enSettings,
    camera: enCamera,
    notifications: enNotifications,
  },
  he: {
    common: heCommon,
    menu: heMenu,
    errors: heErrors,
    auth: heAuth,
    onboarding: heOnboarding,
    quiz: heQuiz,
    home: heHome,
    content: heContent,
    eras: heEras,
    profile: heProfile,
    score: heScore,
    messages: heMessages,
    settings: heSettings,
    camera: heCamera,
    notifications: heNotifications,
  },
};
