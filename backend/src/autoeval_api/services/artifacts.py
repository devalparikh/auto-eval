from __future__ import annotations

from sqlalchemy.orm import Session

from autoeval_api.models import (
    AgentSystemRecord,
    AgentSystemVersionRecord,
    DatasetRecord,
    DatasetVersionRecord,
    PortfolioSnapshotRecord,
    PromptRecord,
    PromptVersionRecord,
)
from autoeval_api.schemas import (
    ArtifactCatalogResponse,
    ArtifactDetail,
    ArtifactKind,
    ArtifactSummary,
    NodePromptArtifactBinding,
    VersionSummary,
)
from autoeval_api.services.datasets import dataset_version_detail
from autoeval_api.services.portfolio_snapshots import portfolio_snapshot_detail


def artifact_catalog(
    session: Session,
    agent_system: AgentSystemRecord,
) -> ArtifactCatalogResponse:
    artifacts: list[ArtifactSummary] = []
    graph_versions = (
        session.query(AgentSystemVersionRecord).filter_by(agent_system_id=agent_system.id).all()
    )
    prompts = session.query(PromptRecord).filter_by(agent_system_id=agent_system.id).all()
    prompt_ids = [prompt.id for prompt in prompts]
    prompt_versions = (
        session.query(PromptVersionRecord)
        .filter(PromptVersionRecord.prompt_id.in_(prompt_ids))
        .all()
        if prompt_ids
        else []
    )
    prompt_by_id = {prompt.id: prompt for prompt in prompts}
    datasets = session.query(DatasetRecord).filter_by(agent_system_id=agent_system.id).all()
    dataset_ids = [dataset.id for dataset in datasets]
    dataset_versions = (
        session.query(DatasetVersionRecord)
        .filter(DatasetVersionRecord.dataset_id.in_(dataset_ids))
        .all()
        if dataset_ids
        else []
    )
    dataset_by_id = {dataset.id: dataset for dataset in datasets}
    snapshots = (
        session.query(PortfolioSnapshotRecord).filter_by(agent_system_id=agent_system.id).all()
    )

    artifacts.extend(_graph_summary(agent_system, version) for version in graph_versions)
    artifacts.extend(
        _prompt_summary(agent_system, prompt_by_id[version.prompt_id], version)
        for version in prompt_versions
    )
    artifacts.extend(
        _dataset_summary(agent_system, dataset_by_id[version.dataset_id], version)
        for version in dataset_versions
    )
    artifacts.extend(_snapshot_summary(agent_system, snapshot) for snapshot in snapshots)
    artifacts.sort(key=lambda item: (item.created_at, item.kind.value, item.id), reverse=True)
    return ArtifactCatalogResponse(
        agent_system_id=agent_system.id,
        agent_system_key=agent_system.key,
        agent_system_name=agent_system.name,
        artifacts=artifacts,
    )


def artifact_detail(
    session: Session,
    kind: ArtifactKind,
    artifact_id: str,
) -> ArtifactDetail:
    if kind == ArtifactKind.GRAPH:
        version = session.get(AgentSystemVersionRecord, artifact_id)
        if version is None:
            raise LookupError("Graph artifact not found")
        owner = _owner(session, version.agent_system_id)
        return ArtifactDetail(
            **_graph_summary(owner, version).model_dump(),
            content=version.definition,
            node_prompt_bindings=_node_prompt_bindings(session, owner, version),
        )
    if kind == ArtifactKind.PROMPT:
        version = session.get(PromptVersionRecord, artifact_id)
        if version is None:
            raise LookupError("Prompt artifact not found")
        prompt = session.get(PromptRecord, version.prompt_id)
        if prompt is None:
            raise LookupError("Prompt artifact owner not found")
        owner = _owner(session, prompt.agent_system_id)
        return ArtifactDetail(
            **_prompt_summary(owner, prompt, version).model_dump(),
            content={"content": version.content, "prompt_id": prompt.id},
        )
    if kind == ArtifactKind.DATASET:
        version = session.get(DatasetVersionRecord, artifact_id)
        if version is None:
            raise LookupError("Dataset artifact not found")
        dataset = session.get(DatasetRecord, version.dataset_id)
        if dataset is None:
            raise LookupError("Dataset artifact owner not found")
        owner = _owner(session, dataset.agent_system_id)
        return ArtifactDetail(
            **_dataset_summary(owner, dataset, version).model_dump(),
            content=dataset_version_detail(session, version).model_dump(mode="json"),
        )
    snapshot = session.get(PortfolioSnapshotRecord, artifact_id)
    if snapshot is None:
        raise LookupError("Portfolio snapshot artifact not found")
    owner = _owner(session, snapshot.agent_system_id)
    detail = portfolio_snapshot_detail(snapshot)
    return ArtifactDetail(
        **_snapshot_summary(owner, snapshot).model_dump(),
        content=detail.content,
    )


def _node_prompt_bindings(
    session: Session,
    owner: AgentSystemRecord,
    graph_version: AgentSystemVersionRecord,
) -> list[NodePromptArtifactBinding]:
    bindings: list[NodePromptArtifactBinding] = []
    for node in graph_version.definition.get("nodes", []):
        if node.get("kind") != "llm":
            continue
        prompt_key = node.get("prompt_key")
        versions: list[PromptVersionRecord] = []
        if prompt_key:
            prompt = (
                session.query(PromptRecord)
                .filter_by(agent_system_id=owner.id, key=prompt_key)
                .first()
            )
            if prompt is not None:
                versions = (
                    session.query(PromptVersionRecord)
                    .filter_by(prompt_id=prompt.id)
                    .order_by(PromptVersionRecord.version.desc())
                    .all()
                )
        bindings.append(
            NodePromptArtifactBinding(
                node_id=node["id"],
                prompt_key=prompt_key,
                uses_legacy_default=prompt_key is None,
                current_prompt_version_id=versions[0].id if versions else None,
                available_versions=[
                    VersionSummary(
                        id=version.id,
                        version=version.version,
                        content_hash=version.content_hash,
                        created_at=version.created_at,
                    )
                    for version in versions
                ],
            )
        )
    return bindings


def _owner(session: Session, owner_id: str) -> AgentSystemRecord:
    owner = session.get(AgentSystemRecord, owner_id)
    if owner is None:
        raise LookupError("Artifact agent system not found")
    return owner


def _graph_summary(
    owner: AgentSystemRecord,
    version: AgentSystemVersionRecord,
) -> ArtifactSummary:
    return ArtifactSummary(
        id=version.id,
        kind=ArtifactKind.GRAPH,
        agent_system_id=owner.id,
        key=f"{owner.key}:graph",
        name=f"{owner.name} graph",
        version=version.version,
        content_hash=version.content_hash,
        created_at=version.created_at,
    )


def _prompt_summary(
    owner: AgentSystemRecord,
    prompt: PromptRecord,
    version: PromptVersionRecord,
) -> ArtifactSummary:
    return ArtifactSummary(
        id=version.id,
        kind=ArtifactKind.PROMPT,
        agent_system_id=owner.id,
        key=prompt.key,
        name=prompt.name,
        version=version.version,
        content_hash=version.content_hash,
        created_at=version.created_at,
    )


def _dataset_summary(
    owner: AgentSystemRecord,
    dataset: DatasetRecord,
    version: DatasetVersionRecord,
) -> ArtifactSummary:
    return ArtifactSummary(
        id=version.id,
        kind=ArtifactKind.DATASET,
        agent_system_id=owner.id,
        key=dataset.key,
        name=dataset.name,
        version=version.version,
        status=version.status,
        created_at=version.created_at,
    )


def _snapshot_summary(
    owner: AgentSystemRecord,
    snapshot: PortfolioSnapshotRecord,
) -> ArtifactSummary:
    return ArtifactSummary(
        id=snapshot.id,
        kind=ArtifactKind.PORTFOLIO_SNAPSHOT,
        agent_system_id=owner.id,
        key=snapshot.id,
        name=snapshot.label,
        status="immutable",
        content_hash=snapshot.content_hash,
        created_at=snapshot.created_at,
    )
