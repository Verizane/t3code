#!/bin/bash

# step 1
git checkout main && \
  git fetch origin && \
  git rebase origin/main

# step 2
git push fork main --force-with-lease && \
  git checkout main-fork && \
  git rebase main

# step 3
git push fork main-fork --force-with-lease
