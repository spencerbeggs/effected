# micromark Directive Extension Syntax

## Inline

### Valid

:name[content]{key=val}

:name[content]

:name{key=val}

:name

prefix:name

## Leaf Block

### Valid

::name[content]{key=val}

::name[content]

::name{key=val}

::name

### Invalid

prefix::name

## Container Block

### Valid

:::name[inline-content]{key=val}
contents
:::

:::name[inline-content]
contents
:::

:::name{key=val}
contents
:::

:::name
contents
:::

### Invalid

prefix:::name[inline-content]{key=val}
contents
:::

<!-- markdownlint-configure-file { "no-duplicate-heading": false } -->
