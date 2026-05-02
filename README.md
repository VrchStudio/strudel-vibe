# Strudel VibeLive

Vibe live coding on the web using local or bring-your-own-key AI models, a fork of [Strudel](https://codeberg.org/uzu/strudel/).

## Added Features

1. **Agent panel** for generating and editing Strudel code with Ollama, OpenAI, Anthropic, Google Gemini.
2. **Background panel** for using any webpage as the REPL background by providing a URL.
3. **MIDI panel** for mapping external MIDI CC controls to the first eight CodeMirror sliders, with Detect, Reverse, range mapping, and pickup/soft takeover.
4. **MIDI to Slider value sync** MIDI and mouse slider changes update the displayed CodeMirror values and stay active when code is reapplied by the agent.

## Setups

### To use a cloud AI provider
Choose OpenAI, Anthropic, or Google Gemini in the agent panel and enter your own API key. Keys are stored in your browser and sent directly to the selected provider.
### To use local AI
1. Install Ollama on your computer and make sure it is running on http://localhost:11434
2. Download an AI model that has good agentic coding capability with a long context window.
3. If you are using https://strudel.vibelive.club, set your Ollama service to allow CORS from `https://*.vibelive.club`  
   For example, on MacOS run
   ```
   launchctl setenv OLLAMA_ORIGINS "https://strudel.vibelive.club,https://*.vibelive.club"
   ```
   in terminal then restart Ollama.
4. If you want to update the AI agent's Strudel API knowledge, use an AI model to regenerate `website/src/repl/components/panel/strudel-reference.js` from official Strudel API reference following the same format.
5. Use `pnpm build` to build locally and `pnpm preview` for local preview, `pnpm dev` for development.

# strudel

Live coding patterns on the web
https://strudel.cc/

- Try it here: <https://strudel.cc>
- Docs: <https://strudel.cc/learn>
- Technical Blog Post: <https://loophole-letters.vercel.app/strudel>
- 1 Year of Strudel Blog Post: <https://loophole-letters.vercel.app/strudel1year>
- 2 Years of Strudel Blog Post: <https://strudel.cc/blog/#year-2>

## Running Locally

After cloning the project, you can run the REPL locally:

1. Install [Node.js](https://nodejs.org/)
2. Install [pnpm](https://pnpm.io/installation)
3. Install dependencies by running the following command:
   ```bash
   pnpm i
   ```
4. Run the development server:
   ```bash
   pnpm dev
   ```

## Using Strudel In Your Project

This project is organized into many [packages](./packages), which are also available on [npm](https://www.npmjs.com/search?q=%40strudel).

Read more about how to use these in your own project [here](https://strudel.cc/technical-manual/project-start).

You will need to abide by the terms of the [GNU Affero Public Licence v3](LICENSE). As such, Strudel code can only be shared within free/open source projects under the same license -- see the license for details.

Licensing info for the default sound banks can be found over on the [dough-samples](https://github.com/felixroos/dough-samples/blob/main/README.md) repository.

## Contributing

There are many ways to contribute to this project! See [contribution guide](./CONTRIBUTING.md). You can find the full list of contributors [here](https://codeberg.org/uzu/strudel/activity/contributors).

## Community

There is a #strudel channel on the TidalCycles discord: <https://discord.com/invite/HGEdXmRkzT>

You can also ask questions and find related discussions on the tidal club forum: <https://club.tidalcycles.org/>

The discord and forum is shared with the haskell (tidal) and python (vortex) siblings of this project.

We also have a mastodon account: <a rel="me" href="https://social.toplap.org/@strudel">social.toplap.org/@strudel</a>
