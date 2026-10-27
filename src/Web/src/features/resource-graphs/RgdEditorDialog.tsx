import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { messageOf } from '../../api/client';
import { useSaveDefinition, useValidateDefinition } from '../../api/hooks';
import { ManifestEditorDialog } from '../../components/ManifestEditorDialog';
import { objectName } from '../../lib/k8s';

type Props = { mode: 'create' | 'edit'; definitionName?: string; initialYaml: string; onClose: () => void };

export function RgdEditorDialog({ mode, definitionName, initialYaml, onClose }: Props) {
  const navigate = useNavigate();
  const [yaml, setYaml] = useState(initialYaml);
  const [notice, setNotice] = useState<string | null>(null);
  const save = useSaveDefinition();
  const validate = useValidateDefinition();
  const error = save.error ?? validate.error;
  const busy = save.isPending || validate.isPending;

  const reset = () => { save.reset(); validate.reset(); setNotice(null); };

  return (
    <ManifestEditorDialog
      kicker="Resource graph YAML"
      title={mode === 'create' ? 'Create resource graph' : 'Edit resource graph'}
      description="Validate with the Kubernetes API (dry run), then apply the manifest."
      value={yaml}
      onChange={(value) => { setYaml(value); reset(); }}
      busy={busy}
      serverError={error ? messageOf(error) : null}
      serverNotice={notice}
      validateLabel="Validate with API"
      onValidate={() => {
        reset();
        validate.mutate({ yaml, update: mode === 'edit' }, { onSuccess: (body) => setNotice(`API validation passed${body?.metadata?.name ? ` for ${body.metadata.name}` : ''}. Nothing was saved.`) });
      }}
      submitLabel={mode === 'create' ? 'Create' : 'Save changes'}
      onSubmit={() => {
        reset();
        save.mutate({ mode, name: definitionName, yaml }, {
          onSuccess: (result) => {
            onClose();
            if (mode === 'create') navigate(`/graphs/${encodeURIComponent(objectName(result))}`);
          },
        });
      }}
      onClose={onClose}
      hint="Server validation performs a dry run and does not persist the manifest. Ctrl/Cmd + Enter saves."
    />
  );
}
