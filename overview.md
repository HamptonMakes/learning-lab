Hampton's Computer Science Concept Learning Lab

---

I want to build a site called Hampton's Computer Science Concept Learning Lab.

The goal is to build an interactive web-based learning tool that uses interactive animations and visualizations to teach people about different complicated computer science concepts that are often skipped with self-taugh individuals or taught in college as theoretical, but not practical.

The site should help me spread concepts that I repeatedly teach and mentor coworkers about- and make it easy for them to understand how to deploy these concepts.

All of the 'lessons' should utilize easy-to-understand (but probably technically complex to build) animations that step the user through the concept, with a clear step-by-step understanding. Typically, each atomic concept then should then be followed up with an example of this working in context of some real problem or in combination with other concepts already taught in the Module.

Modules:
Distributed Data Types (CRDTs)
UUIDs (v4, v7) [coming soon!]
Regex [coming soon!]
Columnar Data Stores (like Cassandra) [coming soon!]

There should be a sort of simple 'script' that goes along with it stepping through each of the concepts. And those should be accompanied by animations that show the changes to the data or what each field means in a certain data structure.

### Communication Style

The communication style in the lesson should use Simple Technical English where possible, avoiding flowerly language- except when wanting to be slightly 'colorful' - like, "Whoops- now we have a problem" or fun bits like that. However, the majority of the language should be as straightforward as possible, using the simplest words to explain these complicated concepts. This will require multiple adversarial reviews.

Do not write large paragraphs or use excessive jargon. Each step in each animation should be a simple sentence or two (max!) that express exactly whats happening or the problem that we are demonstrating.

Additionally, this content should be translated into the top 5 languages in the world after we feel good about the english version, but it should be built for that.

### Example Lesson info

For example, the distributed data type

The meat will be us demonstrating the 'sidecar' data required for each type and show the type's atomic function with a clear animated visualization, showing updating, then the merge method. After demonstrating each atomic type, show it in a larger composed 'document' with a real world example for each. Ideally, we are showing how you can compose multiple of these CRDT data types into complex data structures.

The overall lesson shape should be something like:

Part I - The Problem

1. Show how Concurrent Updates Pose a System Design Challenge (backend server, mobile devices, anytime we have more than one location of data)
2. Show how transactional locking is the traditional answer to allow for concurrent writes
3. Transactional locking requires coordination and connection
4. Many situations require transactional guarentees, but not all- and when they aren't needed- we can use
5. Explain the positive aspects of CRDT and distributed data types- eventual consistency, and merging in any order, and always having rules set for how to resolve disagreements
6. Mostly used in Google Doc like collaborative editing, but they can be used a lot more often than that

Part II- State-Based CRDTs - How they work?

1. Show a LWW Data Structure
2. Show a multi-attribute document resolving updates on different fields (maybe team assignments?)
3. Continue this pattern with all of the major algorithms.

Part III- Opertation-Based CRDTs

1. Explain how any system needs to generate its own identifier (see UUID)
2. Similar to the last one - go through all of the different algorithms with both specific examples, and then showing each one used in a realistic combined context.

Part IV - Vector Clocks

Part V- Any other concepts?

The last sections aren't fleshed out- but I believe you have the concept well enough to continue the pattern consistently.

### Structural Requirements

This site must have simple navigation, allowing you to move between lessons. The layout should be mostly consistent and it's okay if it's more 'desktop' focused than Mobile, simply so we can have enough space to show the animations.

I should understand where I am in a Module > Unit > Topic at all times, and move at my own pace if needed.

The animations should share the same core structure and we should take time to think through all of the most ideal and high quality animations we might want to show, then find a way to go from 'lesson description' to the animation.

For example, we should not write animation code that is 'hardcoded' raw animation data. Instead, we should build a way to expressively define these animation instructions such that creating additional animations gets easier and easier.

The building agent should spend time with the user (me!) choosing the right libraries and way to compose this ability.

### Functional Requirements

- URLs should be sharable and relative- aka, moving between lessons should change the URL so reloading isn't a problem.
- The design should be agreed and set beforehand and should be consistent using a real design system we build.
- It only needs to work on browsers released in the last year- so use any new tech you want
- Start/stop/next/prev speed controls are all required.
- Friendly sound effects can be turned on for when things hit together- like 'bloop' or something- can be disabled by the user.
- Settings are kept in local storage
- Rich user analytics should be plugged into my hosted Umami (info supplied when needed) for lesson usage, completion rate, etc.

### Technical Overview

- Use a modern UI/UX library and best practices for everything
- Needs to be deployable on Kamal
- A postgres database is available if needed in production
- A flexible analtyics layer should be in place, and reporting to umami for now- but reusable and swappable
- Real browser behavior verification tests are required
- No sloppy inconsistent behaviors should arise if another agent comes and makes changes
- Lesson Structure - Lesson data should be stored either in a DB or in JSON files.
- Choose an animation library carefully that can show systems talking to each other, per-attribute merging of data structures, annotating UUID data, showing regex matching logic, sorting lists, and building trees. All of this should be expressable in the animation layer without hacky animation coding. Lets be thoughtful on which animation library we use- or if we want to use built-in modern browser features and build our own library- that is allowed in consultation with the user.

The user will be reviewing the quality of the technical implementation and (even more importantly) the quality of the lessons and animations.

### Required Outcome

First, come up with a simple plan with the lead developer on tech choices and on product layout and design language- etc. Especially around animations.

Then- once you are in implementation, I'm looking for a fully functional Learning website for programmers (and product folks) to have a well fleshed out entire series on CRDTs with expressive fluid animations and high quality simple content.

A user should be able to load the site and navigate and successfully complete the CRDT course having a good understanding of the algorithms and how they can be used to build real applications. Especially how to choose which algorithm for specific data needs. "When to use" kinda thing. They should understand both command and stateful, all the major algorithms, vector clocks, tombstoning, and more.

The site must be visually polished on any desktop web browser size, with a thoughtful layout, easy navigation, and most importantly- the animations MUST be extremely expressive of the ideas which will require many different types of animations and examples.

At minimum, Prototypes of the other Units animations and explainations should exist in to demonstrate that the animation system can handle expressively showing the required types of concepts.

Verification of the quality of the animations is required including durable proof.
