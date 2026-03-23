    // Filtrer les enseignants de cette école pour cette année scolaire uniquement
    const enseignantsAnnee = enseignantsEcole.filter(ens => ens.annee_scolaire === year);
    // Dédoublonner par id_pe (garder une seule entrée par personne)
    const seenPe = new Set();
    const enseignantsAnneeUniques = enseignantsAnnee.filter(ens => {
        const key = ens.id_pe || String(ens.id);
        if (seenPe.has(key)) return false;
        seenPe.add(key);
        return true;
    });
    const enseignantsSansFormation = enseignantsAnneeUniques.filter(ens => {
        const hasFormation = yearFormations.some(f => f.id_pe === ens.id);
        return !hasFormation;
    });
