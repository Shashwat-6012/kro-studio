{{- define "kro-studio.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- define "kro-studio.fullname" -}}
{{- if .Values.fullnameOverride -}}{{ .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}{{- else -}}{{ printf "%s-%s" .Release.Name (include "kro-studio.name" .) | trunc 63 | trimSuffix "-" }}{{- end -}}
{{- end -}}
{{- define "kro-studio.labels" -}}
app.kubernetes.io/name: {{ include "kro-studio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}
{{- define "kro-studio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kro-studio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "kro-studio.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}{{ default (include "kro-studio.fullname" .) .Values.serviceAccount.name }}{{- else -}}{{ required "serviceAccount.name is required when serviceAccount.create is false" .Values.serviceAccount.name }}{{- end -}}
{{- end -}}
