# Script Design Guidelines

## 1. Outline-like Main Function
- Write the top-level main function as a high-level sequential outline of the execution phases
- It should consist only of function calls, variable assignments, simple control flow (conditionals, loops), and helper function calls
- Avoid inline logging, data parsing, or configuration key mapping inside the main function

## 2. Hoisted Pure Helpers
- Define all implementation details in helper functions placed below the main flow
- Name functions to be clear and self-explanatory in the context of the main function
- Write helper functions as pure functions (always pass their inputs explicitly as arguments, do not access outer scopes or closures)
