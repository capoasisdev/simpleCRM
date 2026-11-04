import LeadsView from './LeadsView';

export default function ProspectingView({ currentUser, onNavigate, onScheduleLaterOn }) {
  return (
    <LeadsView
      currentUser={currentUser}
      onNavigate={onNavigate}
      onScheduleLaterOn={onScheduleLaterOn}
      pipelineType="cold"
    />
  );
}
