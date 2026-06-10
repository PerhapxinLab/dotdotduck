/**
 * 33 built-in Pieces, organized by category.
 * See ../../docs/13-pieces.md for the full design.
 */

import type { PieceDefinition } from '../types';
import { PieceCatalog as Catalog } from '../types';

import { Stack, Grid, Split, Card, Tabs, Group } from './layout';
import { Heading, Text, Code, Image, Tag, Divider, Markdown } from './content';
import { Listing, Table, Metric, Timeline } from './data';
import {
  TextField, TextArea, NumberField, PasswordField,
  Checkbox, Switch, Picker, DatePicker, Slider, FilePicker,
} from './inputs';
import { Button, Link, IconButton } from './actions';
import { Spinner, ProgressBar, EmptyState, ErrorState } from './feedback';
import { MediaCard, OptionGroup, ChoiceList } from './selection';
import { Slot } from './slot';

export const builtinPieces: PieceDefinition[] = [
  // layout
  Stack, Grid, Split, Card, Tabs, Group,
  // content
  Heading, Text, Code, Image, Tag, Divider, Markdown,
  // data
  Listing, Table, Metric, Timeline,
  // input
  TextField, TextArea, NumberField, PasswordField,
  Checkbox, Switch, Picker, DatePicker, Slider, FilePicker,
  // rich layout + selection
  MediaCard, OptionGroup, ChoiceList,
  // action
  Button, Link, IconButton,
  // feedback
  Spinner, ProgressBar, EmptyState, ErrorState,
  // slot
  Slot,
];

export function createBuiltinCatalog(): Catalog {
  return new Catalog(builtinPieces);
}
