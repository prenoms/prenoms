import { mount } from "svelte";
import App from "./App.svelte";
import { loadDecks } from "./lib/prenom-list";
import { initDecks } from "./lib/state.svelte";
import "./app.css";

// The Prénom List is fetched here rather than on import, so that no module
// performs a network request merely by being imported — which is what lets the
// state layer be reached from `node --test`.
initDecks(await loadDecks());

export default mount(App, { target: document.getElementById("app")! });
