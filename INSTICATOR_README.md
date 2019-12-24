# Insticator Fork of Prebid.js

## What is different in this fork from the official Prebid.js repository?

Insticator uses `instBid` instead of `pbjs` as the global prebid.js object.
There is also a [modules.json](./modules.json) that should be used when building the project.
In this fork, master branch is not the same as the upstream master branch.
It points to the latest version used by Insticator.
That is, master branch always should be used to building the project.

## How do I figure out which Prebid.js release master branch is based on?

Update your local repository and run `git describe --tags master`.

## How do I build?

Follow Prebid.js instructions but add `--modules=modules.json` to the build command.

## Why does testing fail when running `gulp serve`?

Some tests have hardcoded `pbjs`, which is changed to `instBid` for this fork.
It's OK to skip testing by `gulp serve --notest`.

## What should I do if I know that Insticator adds or removes SSP partners?

Update [modules.json](./modules.json) accordingly.
