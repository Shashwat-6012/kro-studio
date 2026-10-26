import { useState } from 'react';
import { messageOf } from '../../api/client';
import { useSaveInstance } from '../../api/hooks';
import type { K8sObject } from '../../api/types';
import { ManifestEditorDialog } from '../../components/ManifestEditorDialog';
import { parseManifest, toYaml } from '../../lib/yaml';

type Props = {
  mode: 'create' | 'edit';
  definition: string;
  namespace?: string;
  initial: K8sObject;
  onClose: () => void;
  onSaved?: (saved: K8sObject) => void;
};

export function InstanceEditorDialog({ mode, definition, namespace, initial, onClose, onSaved }: Props) {
  const [text, setText] = useState(() => toYaml(initial));
  const save = useSaveInstance();

  const submit = () => {
    const parsed = parseManifest(text);
    if (!parsed.value) return;
    const name = initial.metadata?.name;
    // The backend receives JSON (which is valid YAML) so both parsers accept it.
    save.mutate({ definition, mode, name, namespace, body: JSON.stringify(parsed.value) }, { onSuccess: (saved) => { onSaved?.(saved); onClose(); } });
  };

  return (
    <ManifestEditorDialog
      kicker="Generated API manifest"
      title={mode === 'create' ? 'Create instance' : `Edit ${initial.metadata?.name ?? 'instance'}`}
      description="Edit the manifest and save it to the connected cluster."
      value={text}
      onChange={(value) => { setText(value); save.reset(); }}
      busy={save.isPending}
      serverError={save.error ? messageOf(save.error) : null}
      submitLabel={mode === 'create' ? 'Create' : 'Save changes'}
      onSubmit={submit}
      onClose={onClose}
      hint="The manifest must match the discovered API kind, version, and namespace."
    />
  );
}
